import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from pydantic import HttpUrl

from app.api.app import create_app
from app.config import ConfigError
from app.config.app_config import load_app_config
from app.config.models_registry import LlmEntry, LocalModel, ModelsRegistry, Provider, Roles
from app.config.settings import load_settings
from app.container import Container, build_container
from app.n8n.analyzer import N8nAnalyzer
from app.n8n.chat_graph import build_n8n_chat_graph
from app.n8n.embedder import N8nEmbedder
from app.n8n.wiring import build_n8n_parts


def _route_paths(app: Any) -> list[str]:
    paths: list[str] = []
    for r in app.routes:
        path = getattr(r, "path", None)
        if path:
            paths.append(path)
        if hasattr(r, "original_router"):
            for inner in r.original_router.routes:
                inner_path = getattr(inner, "path", None)
                if inner_path:
                    paths.append(inner_path)
    return paths


def test_n8n_mode_wiring_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_BACKEND", "n8n")
    monkeypatch.setenv("N8N_SHARED_SECRET", "test-secret")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("MODEL_CACHE_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("SPEECH_BACKEND", "fake")

    settings = load_settings(load_app_config(), env_file=tmp_path / ".env")
    c = build_container(settings)

    assert c.n8n is not None
    assert isinstance(c.analyzer, N8nAnalyzer)
    assert isinstance(c.embedder, N8nEmbedder)
    assert c.chat_runs is not None
    factory_attr = "_graph_factory"
    assert getattr(c.chat_runs, factory_attr) == build_n8n_chat_graph

    app = create_app(c)
    paths = _route_paths(app)
    assert "/internal/n8n/tools/search_transcripts" in paths
    assert "/internal/n8n/tools/find_recordings" in paths
    assert "/internal/n8n/tools/summarize" in paths


def test_n8n_mode_missing_secret_raises_config_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_BACKEND", "n8n")
    monkeypatch.delenv("N8N_SHARED_SECRET", raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("MODEL_CACHE_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("SPEECH_BACKEND", "fake")

    settings = load_settings(load_app_config(), env_file=tmp_path / ".env")
    with pytest.raises(ConfigError, match="N8N_SHARED_SECRET is required when AI_BACKEND=n8n"):
        build_container(settings)


def test_n8n_wiring_missing_gemini_raises_config_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("N8N_SHARED_SECRET", "test-secret")
    registry_no_gemini = ModelsRegistry(
        providers={
            "groq": Provider(
                client="openai", base_url=HttpUrl("https://api.groq.com/openai/v1"), key_env="GROQ_API_KEY"
            ),
        },
        roles=Roles(
            llm=[
                LlmEntry(provider="groq", model="groq-model", max_request_tokens=1000, timeout_s=30),
            ],
            llm_analysis=[
                LlmEntry(provider="groq", model="groq-analysis", max_request_tokens=1000, timeout_s=60),
            ],
            embedder=LocalModel(model="bge", device="cpu"),
            asr=LocalModel(model="asr", device="cpu"),
            diarizer=LocalModel(model="diar", device="cpu"),
        ),
    )
    with pytest.raises(ConfigError, match="No google_genai provider configured for llm role"):
        build_n8n_parts(registry_no_gemini)


def test_builtin_mode_wiring(container: Container) -> None:
    assert container.n8n is None
    app = create_app(container)
    paths = _route_paths(app)
    assert not any(p.startswith("/internal") for p in paths)


def test_builtin_mode_leaves_no_n8n_in_sys_modules(tmp_path: Path) -> None:
    code = (
        "import sys;"
        "from app.config.app_config import load_app_config;"
        "from app.config.settings import load_settings;"
        "from app.container import build_container;"
        "from app.api.app import create_app;"
        "s = load_settings(load_app_config());"
        "c = build_container(s);"
        "a = create_app(c);"
        "mods = [m for m in sys.modules if 'app.n8n' in m];"
        "assert not mods, f'Found n8n modules: {mods}';"
        "print('OK')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"Subprocess failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    assert "OK" in result.stdout
