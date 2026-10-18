import dataclasses
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.config.app_config import AppConfig
from app.config.settings import Settings
from app.container import Container
from app.speech import asr_child, diarize_child
from app.speech.real import RealAsr, RealDiarizer, record_download


def _real_bound(container: Container, cache_dir: Path) -> Container:
    settings = container.settings.model_copy(update={"model_cache_dir": cache_dir})
    return dataclasses.replace(
        container,
        settings=settings,
        speech_backend_bound="real",
        asr=RealAsr(container.models, settings),
        diarizer=RealDiarizer(container.models, settings),
    )


def _speech_roles(container: Container) -> tuple[str, str]:
    with TestClient(create_app(container)) as client:
        roles = client.get("/api/v1/health").json()["roles"]
    return roles["asr"], roles["diarizer"]


def _place_model(cache_dir: Path, role: str, model: str) -> Path:
    snapshot = cache_dir / "hf" / "hub" / f"models--{role}" / "snapshots" / "0123abcd"
    (snapshot / "sub").mkdir(parents=True)
    (snapshot / "config.json").write_bytes(b"{}")
    (snapshot / "sub" / "weights.bin").write_bytes(b"weights")
    record_download(cache_dir, "asr" if role == "asr" else "diarizer", model, snapshot)
    return snapshot


def test_health_fake_speech_stays_ready(container: Container) -> None:
    assert _speech_roles(container) == ("ready", "ready")


def test_health_real_speech_not_downloaded_until_models_are_placed(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_TOKEN", "present")
    cache_dir = tmp_path / "cache"
    bound = _real_bound(container, cache_dir)
    assert _speech_roles(bound) == ("Model not downloaded", "Model not downloaded")
    assert not cache_dir.exists()
    asr_snapshot = _place_model(cache_dir, "asr", container.models.roles.asr.model)
    assert _speech_roles(bound) == ("ready", "Model not downloaded")
    _place_model(cache_dir, "diarizer", container.models.roles.diarizer.model)
    assert _speech_roles(bound) == ("ready", "ready")
    (asr_snapshot / "sub" / "weights.bin").unlink()
    assert _speech_roles(bound) == ("Model not downloaded", "ready")


def test_health_real_diarizer_reports_missing_token(container: Container, tmp_path: Path) -> None:
    cache_dir = tmp_path / "cache"
    _place_model(cache_dir, "diarizer", container.models.roles.diarizer.model)
    assert _speech_roles(_real_bound(container, cache_dir))[1] == "Missing HF_TOKEN"


def test_health_ignores_a_download_of_another_model(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache_dir = tmp_path / "cache"
    _place_model(cache_dir, "asr", "some-other-model")
    assert _speech_roles(_real_bound(container, cache_dir))[0] == "Model not downloaded"


@pytest.mark.parametrize("content", ["not json", "[]", '{"asr": 5}', '{"asr": {"model": 1, "files": []}}'])
def test_health_treats_an_unreadable_download_record_as_not_downloaded(
    container: Container, tmp_path: Path, content: str
) -> None:
    cache_dir = tmp_path / "cache"
    snapshot = _place_model(cache_dir, "asr", container.models.roles.asr.model)
    record = next(path for path in (cache_dir / "hf").iterdir() if path.is_file())
    record.write_text(content, encoding="utf-8")
    assert snapshot.is_dir()
    assert _speech_roles(_real_bound(container, cache_dir))[0] == "Model not downloaded"


class EmbedderDownload:
    calls: list[dict[str, object]]

    def __init__(self) -> None:
        self.calls = []

    def __call__(self, **kwargs: object) -> None:
        self.calls.append(kwargs)


@pytest.fixture
def setup_container(container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Container:
    settings = container.settings.model_copy(
        update={"data_dir": tmp_path / "setup-data", "model_cache_dir": tmp_path / "setup-models"}
    )
    bound = _real_bound(dataclasses.replace(container, settings=settings, chat_runs=None), settings.model_cache_dir)
    from app.agents.chat_graph import build_chat_graph
    from app.chats.runs import ChatRuns

    # Chat runs hold their container, so they are rebuilt on the final one.
    bound.chat_runs = ChatRuns(bound, build_chat_graph)

    def isolated_settings(app: AppConfig) -> Settings:
        return bound.settings

    def built(settings: Settings) -> Container:
        assert settings is bound.settings
        return bound

    monkeypatch.setattr("app.cli.load_settings", isolated_settings)
    monkeypatch.setattr("app.cli.build_container", built)
    return bound


def test_setup_without_speech_extra_downloads_the_embedder_and_prints_names_only(
    setup_container: Container, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from app import cli

    download = EmbedderDownload()
    monkeypatch.setattr(cli, "TextEmbedding", download)
    monkeypatch.setattr(cli, "speech_extra_installed", lambda: False)
    first = setup_container.models.roles.llm[0]
    present_key = setup_container.models.providers[first.provider].key_env
    monkeypatch.setenv(present_key, "secret-value-123")
    cli.main(["setup"])
    settings = setup_container.settings
    assert settings.data_dir.is_dir()
    assert settings.model_cache_dir.is_dir()
    assert download.calls == [
        {"model_name": setup_container.models.roles.embedder.model, "cache_dir": str(settings.model_cache_dir)}
    ]
    out = capsys.readouterr().out
    assert "secret-value-123" not in out
    assert "asr: Model not downloaded" in out
    assert "diarizer: Missing HF_TOKEN" in out
    assert "llm: ready" in out
    missing = next(line for line in out.splitlines() if line.startswith("Missing environment variables:"))
    assert "HF_TOKEN" in missing
    assert present_key not in missing
    assert "speech extra" in out


def test_setup_with_speech_extra_downloads_and_records_speech_models(
    setup_container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from app import cli

    monkeypatch.setattr(cli, "TextEmbedding", EmbedderDownload())
    monkeypatch.setattr(cli, "speech_extra_installed", lambda: True)
    monkeypatch.setenv("HF_TOKEN", "hf-secret-value")
    hub_dirs: list[Path] = []
    tokens: list[str] = []

    def snapshot(name: str) -> Path:
        folder = tmp_path / "setup-models" / "hf" / "hub" / f"models--{name}" / "snapshots" / "abc"
        folder.mkdir(parents=True)
        (folder / "model.bin").write_bytes(b"weights")
        return folder

    def download_asr(model: str, hub_dir: Path) -> Path:
        assert model == setup_container.models.roles.asr.model
        hub_dirs.append(hub_dir)
        return snapshot("asr")

    def download_diarizer(model: str, hub_dir: Path, token: str) -> Path:
        assert model == setup_container.models.roles.diarizer.model
        hub_dirs.append(hub_dir)
        tokens.append(token)
        return snapshot("diarizer")

    monkeypatch.setattr(asr_child, "download", download_asr)
    monkeypatch.setattr(diarize_child, "download", download_diarizer)
    cli.main(["setup"])
    hub = setup_container.settings.model_cache_dir / "hf" / "hub"
    assert hub_dirs == [hub, hub]
    assert tokens == ["hf-secret-value"]
    out = capsys.readouterr().out
    assert "hf-secret-value" not in out
    assert "asr: ready" in out
    assert "diarizer: ready" in out
    assert "HF_TOKEN" not in out


def test_record_download_lists_snapshot_files_under_the_hf_home(tmp_path: Path) -> None:
    cache_dir = tmp_path / "cache"
    _place_model(cache_dir, "asr", "model-a")
    records = [path for path in (cache_dir / "hf").iterdir() if path.is_file()]
    assert len(records) == 1
    data = json.loads(records[0].read_text(encoding="utf-8"))
    assert data["asr"]["model"] == "model-a"
    snapshot = "hub/models--asr/snapshots/0123abcd"
    assert sorted(data["asr"]["files"]) == [f"{snapshot}/config.json", f"{snapshot}/sub/weights.bin"]
