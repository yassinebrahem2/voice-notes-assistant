import dataclasses
import os
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
import yaml
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.config.app_config import load_app_config
from app.config.settings import Settings, load_settings
from app.container import Container, build_container
from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.processing.fakes import FakeAnalyzer
from app.rag.fakes import FakeEmbedder


@pytest.fixture(autouse=True)
def isolate_provider_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    # Dotenv mutates os.environ directly, so isolate the mapping itself as well as its keys.
    monkeypatch.setattr(os, "environ", os.environ.copy())
    # Tests must neither inherit machine-specific settings nor read a developer's dotenv file.
    for field in Settings.model_fields:
        for env_name in tuple(os.environ):
            if env_name.lower() == field:
                monkeypatch.delenv(env_name, raising=False)
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    registry_path = Path(__file__).resolve().parents[2] / "config" / "models.yaml"
    registry = cast(dict[str, dict[str, dict[str, str]]], yaml.safe_load(registry_path.read_text(encoding="utf-8")))
    for provider in registry["providers"].values():
        monkeypatch.delenv(provider["key_env"], raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)


@pytest.fixture
def container(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Container:
    env_file = tmp_path / ".env"
    env_file.write_text("", encoding="utf-8")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("MODEL_CACHE_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("SPEECH_BACKEND", "fake")
    settings = load_settings(load_app_config(), env_file=env_file)
    # Real models would download or need keys as soon as a test indexes or analyzes.
    result = dataclasses.replace(
        build_container(settings), embedder=FakeEmbedder(), analyzer=FakeAnalyzer(), chat_runs=None
    )
    from app.agents.chat_graph import build_chat_graph
    from app.chats.runs import ChatRuns

    # Chat runs hold their container, so they are rebuilt on the one carrying the fakes.
    result.chat_runs = ChatRuns(result, build_chat_graph)
    result.settings.data_dir.mkdir(parents=True)
    connection = connect(result.db_path)
    try:
        apply_migrations(connection)
    finally:
        connection.close()
    return result


@pytest.fixture
def client(container: Container) -> Iterator[TestClient]:
    with TestClient(create_app(container)) as test_client:
        yield test_client
