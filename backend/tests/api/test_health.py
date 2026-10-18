from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.config.settings import load_settings
from app.container import Container, build_container


def test_health_reports_roles(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(create_app(container)) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert data["app_name"] == container.app_config.name
        assert data["version"] == container.app_config.version
        assert data["speech_backend"] == "fake"
        assert set(data["roles"]) == {"llm", "llm_analysis", "embedder", "asr", "diarizer"}
        first = container.models.roles.llm[0]
        env_name = container.models.providers[first.provider].key_env
        assert env_name in data["roles"]["llm"]
        for provider in container.models.providers.values():
            monkeypatch.setenv(provider.key_env, "present")
        assert all(value == "ready" for value in client.get("/api/v1/health").json()["roles"].values())


def test_health_reports_bound_backend(container: Container) -> None:
    container.settings.speech_backend = "real"
    with TestClient(create_app(container)) as client:
        assert client.get("/api/v1/health").json()["speech_backend"] == "fake"


def test_keys_from_env_file_reach_health(container: Container, tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text(
        "\n".join(f"{provider.key_env}=present" for provider in container.models.providers.values()), encoding="utf-8"
    )
    settings = load_settings(container.app_config, path)
    with TestClient(create_app(build_container(settings))) as client:
        assert client.get("/api/v1/health").json()["roles"]["llm"] == "ready"


def test_real_bound_diarizer_checks_hf_token(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    container.speech_backend_bound = "real"
    monkeypatch.setattr("app.api.routes.health.speech_extra_installed", lambda: True)
    with TestClient(create_app(container)) as client:
        response = client.get("/api/v1/health")
        assert response.json()["speech_backend"] == "real"
        assert response.json()["roles"]["diarizer"] == "Missing HF_TOKEN"
        monkeypatch.setenv("HF_TOKEN", "present")
        assert client.get("/api/v1/health").json()["roles"]["diarizer"] == "ready"


@pytest.mark.parametrize("role", ["llm", "llm_analysis"])
def test_fallback_key_makes_role_ready(container: Container, monkeypatch: pytest.MonkeyPatch, role: str) -> None:
    entries = getattr(container.models.roles, role)
    first_key = container.models.providers[entries[0].provider].key_env
    fallback_key = container.models.providers[entries[1].provider].key_env
    assert first_key != fallback_key
    monkeypatch.setenv(fallback_key, "present")
    with TestClient(create_app(container)) as client:
        assert client.get("/api/v1/health").json()["roles"][role] == "ready"


def test_no_key_names_every_missing_key_in_role_order(container: Container) -> None:
    with TestClient(create_app(container)) as client:
        roles = client.get("/api/v1/health").json()["roles"]
    assert roles["llm"] == "Missing GROQ_API_KEY and GEMINI_API_KEY"
    assert roles["llm_analysis"] == "Missing GEMINI_API_KEY and GROQ_API_KEY"


def test_join_key_names() -> None:
    from app.api.routes.health import join_key_names

    assert join_key_names(["A"]) == "A"
    assert join_key_names(["A", "B"]) == "A and B"
    assert join_key_names(["A", "B", "C"]) == "A, B and C"


def test_real_bound_reports_speech_extra_not_installed_when_extra_missing(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    container.speech_backend_bound = "real"
    monkeypatch.setattr("app.api.routes.health.speech_extra_installed", lambda: False, raising=False)
    monkeypatch.setattr("app.speech.real.speech_extra_installed", lambda: False, raising=False)
    with TestClient(create_app(container)) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        roles = response.json()["roles"]
        assert roles["asr"] == "Speech extra not installed"
        assert roles["diarizer"] == "Speech extra not installed"


def test_fake_bound_reports_ready_even_when_speech_extra_missing(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.routes.health.speech_extra_installed", lambda: False, raising=False)
    monkeypatch.setattr("app.speech.real.speech_extra_installed", lambda: False, raising=False)
    for provider in container.models.providers.values():
        monkeypatch.setenv(provider.key_env, "present")
    with TestClient(create_app(container)) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        roles = response.json()["roles"]
        assert roles["asr"] == "ready"
        assert roles["diarizer"] == "ready"
