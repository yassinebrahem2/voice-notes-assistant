from pathlib import Path
from typing import Literal

import pytest

from app.config.models_registry import ModelsRegistry
from app.config.settings import Settings
from app.container import Container, build_container
from app.db.connection import connect
from app.processing.fakes import FakeAnalyzer
from app.rag import fastembed_embedder
from app.rag.fakes import FakeEmbedder
from app.rag.fastembed_embedder import FastEmbedEmbedder
from app.speech.fakes import FakeAsr, FakeDiarizer
from app.speech.protocols import AsrSegment, DiarTurn


def test_build_container_uses_fakes(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path / "data", model_cache_dir=tmp_path / "models", speech_backend="fake")
    container = build_container(settings)
    assert container.settings is settings
    assert container.db_path == settings.data_dir / "app.db"
    assert container.speech_backend_bound == "fake"
    assert isinstance(container.asr, FakeAsr)
    assert isinstance(container.diarizer, FakeDiarizer)
    assert isinstance(container.embedder, FastEmbedEmbedder)
    assert isinstance(container.analyzer, FakeAnalyzer)
    assert not container.db_path.exists()


def test_container_fixture_has_migrated_database(container: Container) -> None:
    connection = connect(container.db_path)
    try:
        assert connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 1
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        connection.close()


@pytest.mark.parametrize("backend", ["real", "fake"])
def test_container_binds_fastembed_embedder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, backend: Literal["real", "fake"]
) -> None:
    def refuse(**kwargs: object) -> None:
        raise AssertionError("TextEmbedding must not be created")

    monkeypatch.setattr(fastembed_embedder, "TextEmbedding", refuse)
    settings = Settings(data_dir=tmp_path / "data", model_cache_dir=tmp_path / "models", speech_backend=backend)
    container = build_container(settings)
    assert isinstance(container.embedder, FastEmbedEmbedder)
    assert container.embedder.model_id == container.models.roles.embedder.model
    assert container.embedder.cache_dir == settings.model_cache_dir


def test_fixture_container_uses_fakes(container: Container) -> None:
    assert isinstance(container.embedder, FakeEmbedder)
    assert isinstance(container.analyzer, FakeAnalyzer)


class BoundSpeech:
    def __init__(self, models: ModelsRegistry, settings: Settings) -> None:
        self.models = models
        self.settings = settings


class BoundAsr(BoundSpeech):
    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        raise AssertionError("not called")


class BoundDiarizer(BoundSpeech):
    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        raise AssertionError("not called")


def test_container_binds_real_speech_when_configured(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.container.RealAsr", BoundAsr)
    monkeypatch.setattr("app.container.RealDiarizer", BoundDiarizer)
    settings = Settings(data_dir=tmp_path / "data", model_cache_dir=tmp_path / "models", speech_backend="real")
    container = build_container(settings)
    assert container.speech_backend_bound == "real"
    assert isinstance(container.asr, BoundAsr)
    assert isinstance(container.diarizer, BoundDiarizer)
    for bound in (container.asr, container.diarizer):
        assert bound.models is container.models
        assert bound.settings is settings
    assert not (tmp_path / "models").exists()
