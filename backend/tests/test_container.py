from pathlib import Path
from typing import Literal

import pytest

from app.config.settings import Settings
from app.container import Container, build_container
from app.db.connection import connect
from app.processing.fakes import FakeAnalyzer
from app.rag.fakes import FakeEmbedder
from app.speech.fakes import FakeAsr, FakeDiarizer


@pytest.mark.parametrize("backend", ["real", "fake"])
def test_build_container_uses_fakes(tmp_path: Path, backend: Literal["real", "fake"]) -> None:
    settings = Settings(data_dir=tmp_path / "data", model_cache_dir=tmp_path / "models", speech_backend=backend)
    container = build_container(settings)
    assert container.settings is settings
    assert container.db_path == settings.data_dir / "app.db"
    assert container.speech_backend_bound == "fake"
    assert isinstance(container.asr, FakeAsr)
    assert isinstance(container.diarizer, FakeDiarizer)
    assert isinstance(container.embedder, FakeEmbedder)
    assert isinstance(container.analyzer, FakeAnalyzer)
    assert not container.db_path.exists()


def test_container_fixture_has_migrated_database(container: Container) -> None:
    connection = connect(container.db_path)
    try:
        assert connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 1
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        connection.close()
