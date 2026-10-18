import dataclasses
import socket
from collections.abc import Iterable
from pathlib import Path
from typing import Any, ClassVar

import numpy as np
import pytest
from fastapi.testclient import TestClient
from fastembed import TextEmbedding

from app.api.app import create_app
from app.config.settings import Settings
from app.container import Container, build_container
from app.rag import fastembed_embedder
from app.rag.fastembed_embedder import FastEmbedEmbedder

QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


class RaisingTextEmbedding(TextEmbedding):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise AssertionError("TextEmbedding must not be created")


class RecordingTextEmbedding:
    created: ClassVar[list[dict[str, Any]]] = []
    calls: ClassVar[list[list[str]]] = []

    def __init__(self, **kwargs: Any) -> None:
        RecordingTextEmbedding.created.append(kwargs)

    def embed(self, documents: Iterable[str]) -> Iterable[np.ndarray[Any, np.dtype[np.float32]]]:
        texts = list(documents)
        RecordingTextEmbedding.calls.append(texts)
        return [np.full(384, 0.25, dtype=np.float32) for _ in texts]


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> type[RecordingTextEmbedding]:
    monkeypatch.setattr(RecordingTextEmbedding, "created", [])
    monkeypatch.setattr(RecordingTextEmbedding, "calls", [])
    monkeypatch.setattr(fastembed_embedder, "TextEmbedding", RecordingTextEmbedding)
    return RecordingTextEmbedding


def refuse_connections(monkeypatch: pytest.MonkeyPatch) -> None:
    def connect(*args: object) -> None:
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", connect)


def test_constructing_embedder_touches_no_network(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fastembed_embedder, "TextEmbedding", RaisingTextEmbedding)
    refuse_connections(monkeypatch)
    cache_dir = tmp_path / "models"
    embedder = FastEmbedEmbedder("example/model", cache_dir)
    assert embedder.dim == 384
    settings = Settings(data_dir=tmp_path / "data", model_cache_dir=cache_dir, speech_backend="real")
    assert isinstance(build_container(settings).embedder, FastEmbedEmbedder)
    assert not cache_dir.exists()


def test_embed_query_adds_bge_prefix(tmp_path: Path, recorder: type[RecordingTextEmbedding]) -> None:
    embedder = FastEmbedEmbedder("example/model", tmp_path / "models")
    query = embedder.embed_query("what did we decide?")
    passages = embedder.embed_passages(["first passage", "second passage"])
    assert recorder.calls == [[f"{QUERY_PREFIX}what did we decide?"], ["first passage", "second passage"]]
    assert recorder.created == [{"model_name": "example/model", "cache_dir": str(tmp_path / "models")}]
    for vector in (query, *passages):
        assert len(vector) == embedder.dim
        assert all(type(value) is float for value in vector)
    assert len(passages) == 2


def write_cached_model(cache_dir: Path, model_id: str, *, with_ref: bool = True, with_model_file: bool = True) -> None:
    # Mirrors the Hugging Face hub cache layout fastembed downloads into.
    description = next(
        model for model in TextEmbedding.list_supported_models() if model["model"].lower() == model_id.lower()
    )
    repo_dir = cache_dir / ("models--" + str(description["sources"]["hf"]).replace("/", "--"))
    snapshot = repo_dir / "snapshots" / "0123abcd"
    snapshot.mkdir(parents=True)
    if with_ref:
        (repo_dir / "refs").mkdir()
        (repo_dir / "refs" / "main").write_text("0123abcd", encoding="utf-8")
    files = [str(name) for name in description["additional_files"]]
    if with_model_file:
        files.append(str(description["model_file"]))
    for name in files:
        (snapshot / name).parent.mkdir(parents=True, exist_ok=True)
        (snapshot / name).write_bytes(b"weights")


def embedder_health(container: Container, cache_dir: Path) -> str:
    model_id = container.models.roles.embedder.model
    bound = dataclasses.replace(container, embedder=FastEmbedEmbedder(model_id, cache_dir))
    with TestClient(create_app(bound)) as client:
        return client.get("/api/v1/health").json()["roles"]["embedder"]


@pytest.mark.parametrize(
    ("with_ref", "with_model_file", "expected"),
    [(True, True, "ready"), (False, True, "Model not downloaded"), (True, False, "Model not downloaded")],
)
def test_health_embedder_ready_when_cached(
    container: Container,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    with_ref: bool,
    with_model_file: bool,
    expected: str,
) -> None:
    monkeypatch.setattr(fastembed_embedder, "TextEmbedding", RaisingTextEmbedding)
    refuse_connections(monkeypatch)
    cache_dir = tmp_path / "cache"
    assert embedder_health(container, cache_dir) == "Model not downloaded"
    write_cached_model(
        cache_dir, container.models.roles.embedder.model, with_ref=with_ref, with_model_file=with_model_file
    )
    assert embedder_health(container, cache_dir) == expected
