import json
import os
from typing import cast

import httpx
import pytest
from pydantic import SecretStr

from app.n8n.client import N8nBadResponse, N8nClient
from app.n8n.embedder import N8nEmbedder
from app.n8n.settings import N8nSettings


@pytest.fixture(autouse=True)
def clean_n8n_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in tuple(os.environ):
        if key.startswith("N8N_") or key == "AI_BACKEND":
            monkeypatch.delenv(key, raising=False)


def test_embedder_batches_and_keeps_order() -> None:
    captured_requests: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content.decode("utf-8"))
        captured_requests.append(data)
        raw_texts = data.get("texts")
        assert isinstance(raw_texts, list)
        texts = cast(list[object], raw_texts)
        vectors: list[list[float]] = []
        for t in texts:
            idx = int(str(t).split("_")[1])
            vec = [float(idx)] + [0.0] * 767
            vectors.append(vec)
        return httpx.Response(200, json={"vectors": vectors})

    transport = httpx.MockTransport(handler)
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    embedder = N8nEmbedder(client, "gemini-embedding-001")

    assert embedder.dim == 768

    # 230 passages
    texts = [f"text_{i}" for i in range(230)]
    vectors = embedder.embed_passages(texts)

    assert len(vectors) == 230
    assert len(captured_requests) == 3

    # Check batches
    assert captured_requests[0]["model"] == "gemini-embedding-001"
    assert captured_requests[0]["task"] == "RETRIEVAL_DOCUMENT"
    assert len(cast_list(captured_requests[0]["texts"])) == 100

    assert captured_requests[1]["model"] == "gemini-embedding-001"
    assert captured_requests[1]["task"] == "RETRIEVAL_DOCUMENT"
    assert len(cast_list(captured_requests[1]["texts"])) == 100

    assert captured_requests[2]["model"] == "gemini-embedding-001"
    assert captured_requests[2]["task"] == "RETRIEVAL_DOCUMENT"
    assert len(cast_list(captured_requests[2]["texts"])) == 30

    # Check input order preserved
    for i, vec in enumerate(vectors):
        assert len(vec) == 768
        assert vec[0] == float(i)

    # Test embed_query
    query_captured: list[dict[str, object]] = []

    def query_handler(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content.decode("utf-8"))
        query_captured.append(data)
        return httpx.Response(200, json={"vectors": [[42.0] + [0.0] * 767]})

    q_transport = httpx.MockTransport(query_handler)
    q_client = N8nClient(settings, SecretStr("test-secret"), transport=q_transport)
    q_embedder = N8nEmbedder(q_client, "gemini-embedding-001")

    query_vec = q_embedder.embed_query("search query")
    assert len(query_vec) == 768
    assert query_vec[0] == 42.0
    assert len(query_captured) == 1
    assert query_captured[0] == {
        "model": "gemini-embedding-001",
        "texts": ["search query"],
        "task": "RETRIEVAL_QUERY",
    }


def cast_list(val: object) -> list[object]:
    assert isinstance(val, list)
    return cast(list[object], val)


@pytest.mark.parametrize(
    "bad_reply",
    [
        {"vectors": []},  # Wrong count
        {"vectors": [[1.0] * 512]},  # Wrong dim
        {"vectors": "not-a-list"},  # Invalid type
        {"other": 123},  # Missing vectors key
    ],
)
def test_embedder_bad_response(bad_reply: dict[str, object]) -> None:
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json=bad_reply))
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    embedder = N8nEmbedder(client, "gemini-embedding-001")

    with pytest.raises(N8nBadResponse):
        embedder.embed_query("text")

    with pytest.raises(N8nBadResponse):
        embedder.embed_passages(["text"])
