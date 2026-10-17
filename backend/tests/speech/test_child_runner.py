import dataclasses
import importlib.util
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.config.app_config import AppConfig
from app.config.settings import Settings
from app.container import Container
from app.db.connection import connect
from app.processing.worker import Worker
from app.speech import asr_child, diarize_child, real
from app.speech.child import BACKEND_DIR, ChildFailed, ChildOutputError, run_child
from app.speech.protocols import AsrSegment, DiarTurn
from app.speech.real import RealAsr, RealDiarizer, record_download
from tests.fixtures.audio_gen import sine_m4a
from tests.seed import seed_recording

ECHO = "tests.speech.echo_child"
HEAVY_MODULES = ("torch", "torchaudio", "faster_whisper", "pyannote", "pyannote.audio")


@pytest.fixture
def child_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Points the temp dir at an empty folder, so a test can see the runner left nothing behind."""
    folder = tmp_path / "child-tmp"
    folder.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(folder))
    return folder


def test_run_child_returns_json(child_tmp: Path) -> None:
    result = run_child(ECHO, ["--mode", "ok"], timeout_s=30, env=os.environ)
    assert result["path_set"] is True
    argv = result["argv"]
    assert isinstance(argv, list)
    assert argv[:2] == ["--mode", "ok"]
    assert argv[2] == "--out"
    assert list(child_tmp.iterdir()) == []


def test_run_child_passes_full_environment(child_tmp: Path, tmp_path: Path) -> None:
    env = {**os.environ, "HF_HOME": str(tmp_path / "hf")}
    result = run_child(ECHO, ["--mode", "ok"], timeout_s=30, env=env)
    assert result["path_set"] is True
    assert result["hf_home"] == str(tmp_path / "hf")


def test_run_child_runs_from_any_working_directory(
    child_tmp: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert run_child(ECHO, ["--mode", "ok"], timeout_s=30, env=os.environ)["path_set"] is True


def test_run_child_nonzero_exit_raises(child_tmp: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    with pytest.raises(ChildFailed) as raised:
        run_child(ECHO, ["--mode", "fail"], timeout_s=30, env=os.environ)
    assert raised.value.returncode == 3
    assert "marker" not in str(raised.value)
    assert "echo child stderr marker" in caplog.text
    assert list(child_tmp.iterdir()) == []


def test_run_child_timeout_kills_and_raises(child_tmp: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    started = time.monotonic()
    with pytest.raises(ChildFailed) as raised:
        run_child(ECHO, ["--mode", "hang"], timeout_s=1, env=os.environ)
    assert time.monotonic() - started < 15
    assert raised.value.returncode is None
    assert "marker" not in str(raised.value)
    assert list(child_tmp.iterdir()) == []


def test_run_child_rejects_output_that_is_not_a_json_object(child_tmp: Path) -> None:
    with pytest.raises(ChildOutputError):
        run_child(ECHO, ["--mode", "garbage"], timeout_s=30, env=os.environ)
    assert list(child_tmp.iterdir()) == []


def test_child_modules_import_without_speech_extra() -> None:
    # A fresh interpreter where the speech packages cannot be imported, as in CI; a None entry blocks an import.
    modules = ("app.speech.asr_child", "app.speech.diarize_child", "app.speech.real")
    modules += ("app.container", "app.cli", "app.api.routes.health")
    code = "; ".join(
        [
            "import importlib, sys",
            f"sys.modules.update(dict.fromkeys({HEAVY_MODULES!r}))",
            f"[importlib.import_module(name) for name in {modules!r}]",
        ]
    )
    completed = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=60, check=False
    )
    assert completed.returncode == 0, completed.stderr


class ChildCall:
    def __init__(self, module: str, args: list[str], timeout_s: float, env: Mapping[str, str]) -> None:
        self.module = module
        self.args = args
        self.timeout_s = timeout_s
        self.env = dict(env)


def fake_run_child(monkeypatch: pytest.MonkeyPatch, output: dict[str, object]) -> list[ChildCall]:
    calls: list[ChildCall] = []

    def run(module: str, args: list[str], *, timeout_s: float, env: Mapping[str, str]) -> dict[str, object]:
        calls.append(ChildCall(module, args, timeout_s, env))
        return output

    monkeypatch.setattr(real, "run_child", run)
    return calls


def test_real_asr_runs_its_child_with_the_role_and_full_environment(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output: dict[str, object] = {"segments": [{"start_ms": 0, "end_ms": 1500, "text": "Hello there."}]}
    calls = fake_run_child(monkeypatch, output)
    container.settings.speech_step_timeout_s = 42
    asr = RealAsr(container.models, container.settings)
    # serve sets this after the container is built, so the environment is read for each call.
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    segments = asr.transcribe(tmp_path / "audio.npy")
    assert segments == [AsrSegment(0, 1500, "Hello there.")]
    role = container.models.roles.asr
    (call,) = calls
    assert call.module == "app.speech.asr_child"
    assert call.args == [
        "--audio",
        str(tmp_path / "audio.npy"),
        "--model",
        role.model,
        "--device",
        role.device,
        "--compute",
        str(role.compute_type),
    ]
    assert call.timeout_s == 42
    assert call.env["HF_HOME"] == str(container.settings.model_cache_dir / "hf")
    assert call.env["HF_HUB_OFFLINE"] == "1"
    assert call.env["PATH"] == os.environ["PATH"]


def test_real_diarizer_runs_its_child_with_the_role_and_full_environment(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output: dict[str, object] = {"turns": [{"start_ms": 0, "end_ms": 900, "speaker": "SPEAKER_00"}]}
    calls = fake_run_child(monkeypatch, output)
    diarizer = RealDiarizer(container.models, container.settings)
    monkeypatch.setenv("HF_TOKEN", "token-value")
    turns = diarizer.diarize(tmp_path / "audio.npy")
    assert turns == [DiarTurn(0, 900, "SPEAKER_00")]
    role = container.models.roles.diarizer
    (call,) = calls
    assert call.module == "app.speech.diarize_child"
    assert call.args == ["--audio", str(tmp_path / "audio.npy"), "--model", role.model, "--device", role.device]
    assert call.timeout_s == container.settings.speech_step_timeout_s
    assert call.env["HF_HOME"] == str(container.settings.model_cache_dir / "hf")
    assert call.env["HF_TOKEN"] == os.environ["HF_TOKEN"]


@pytest.mark.parametrize(
    "output",
    [
        {},
        {"segments": "nope"},
        {"segments": [{"start_ms": "0", "end_ms": 1, "text": "x"}]},
        {"segments": [{"start_ms": 0, "end_ms": 1}]},
    ],
)
def test_real_asr_rejects_malformed_child_output(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, output: dict[str, object]
) -> None:
    fake_run_child(monkeypatch, output)
    with pytest.raises(ChildOutputError):
        RealAsr(container.models, container.settings).transcribe(tmp_path / "audio.npy")


def test_real_diarizer_rejects_malformed_child_output(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_run_child(monkeypatch, {"turns": [{"start_ms": 0, "end_ms": 1, "speaker": 7}]})
    with pytest.raises(ChildOutputError):
        RealDiarizer(container.models, container.settings).diarize(tmp_path / "audio.npy")


def _queue_meeting(container: Container) -> str:
    with closing(connect(container.db_path)) as conn:
        rec_id = seed_recording(conn, kind="meeting", status="uploaded", title=None, segments=())
    path = container.settings.data_dir / "audio" / f"{rec_id}.m4a"
    path.parent.mkdir(parents=True, exist_ok=True)
    sine_m4a(path)
    return rec_id


def _failure(container: Container, rec_id: str) -> tuple[str, str, str]:
    with closing(connect(container.db_path)) as conn:
        row = conn.execute("SELECT status, failed_step, error_code FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    return (row["status"], row["failed_step"], row["error_code"])


def _failing_child(module: str, args: list[str], *, timeout_s: float, env: Mapping[str, str]) -> dict[str, object]:
    raise ChildFailed(1)


def test_failed_asr_child_fails_the_transcribing_step(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(real, "run_child", _failing_child)
    rec_id = _queue_meeting(container)
    assert Worker(dataclasses.replace(container, asr=RealAsr(container.models, container.settings))).run_once()
    assert _failure(container, rec_id) == ("failed", "transcribing", "transcription_failed")


def test_failed_diarizer_child_fails_the_diarizing_step(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(real, "run_child", _failing_child)
    rec_id = _queue_meeting(container)
    bound = dataclasses.replace(container, diarizer=RealDiarizer(container.models, container.settings))
    assert Worker(bound).run_once()
    assert _failure(container, rec_id) == ("failed", "diarizing", "diarization_failed")


@pytest.mark.skipif(importlib.util.find_spec("faster_whisper") is not None, reason="needs the speech extra absent")
def test_real_asr_child_without_speech_extra_raises_child_failed(
    container: Container, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    with pytest.raises(ChildFailed) as raised:
        RealAsr(container.models, container.settings).transcribe(tmp_path / "audio.npy")
    assert raised.value.returncode not in (0, None)
    assert "faster_whisper" in caplog.text


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
    bound = _real_bound(dataclasses.replace(container, settings=settings), settings.model_cache_dir)

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
