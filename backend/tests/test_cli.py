import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.cli import main
from app.config.app_config import AppConfig
from app.config.settings import Settings
from app.container import Container
from app.db.connection import connect


@pytest.fixture
def cli_container(container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Container:
    container.settings.data_dir = tmp_path / "cli-data"
    container.settings.bind_host = "127.0.0.1"
    container.settings.port = 8123

    def isolated_settings(app: AppConfig) -> Settings:
        return container.settings

    monkeypatch.setattr("app.cli.load_settings", isolated_settings)
    return container


def test_export_does_not_create_runtime_data(
    cli_container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.cli.OPENAPI_PATH", tmp_path / "openapi.json")
    main(["export-openapi"])
    main(["export-openapi", "--check"])
    assert not cli_container.settings.data_dir.exists()


def test_serve_migrates_and_uses_configured_bind(cli_container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []

    def run(app: FastAPI, *, host: str, port: int) -> None:
        assert host == "127.0.0.1"
        assert port == 8123
        assert os.environ["HF_HUB_OFFLINE"] == "1"
        db = connect(cli_container.settings.data_dir / "app.db")
        try:
            assert db.execute("SELECT version FROM schema_migrations").fetchone()[0] == "001"
        finally:
            db.close()
        with TestClient(app) as client:
            assert client.get("/api/v1/health").status_code == 200
        called.append(True)

    monkeypatch.setattr("app.cli.uvicorn.run", run)
    main(["serve"])
    assert called == [True]
