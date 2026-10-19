import asyncio
import dataclasses
import json
import os
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.chats.runs import ChatRuns
from app.container import Container
from app.n8n.analyzer import N8nAnalyzer
from app.n8n.chat_graph import build_n8n_chat_graph
from app.n8n.client import N8nClient
from app.n8n.embedder import N8nEmbedder
from app.n8n.settings import N8nSettings
from app.n8n.wiring import N8nParts

UNIT_VECTOR_768: list[float] = [1.0] + [0.0] * 767


@pytest.fixture(autouse=True)
def clean_n8n_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in tuple(os.environ):
        if key.startswith("N8N_") or key == "AI_BACKEND":
            monkeypatch.delenv(key, raising=False)


class N8nMockDispatcher:
    """Dispatches sync and async n8n webhook calls to registered mock handlers."""

    def __init__(self) -> None:
        self.chat_handler: Callable[[httpx.Request], Any] | None = None
        self.embed_handler: Callable[[httpx.Request], Any] | None = None
        self.sync_routes: dict[str, Callable[[httpx.Request], httpx.Response]] = {}
        self.async_routes: dict[str, Callable[[httpx.Request], Any]] = {}

    def sync_handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path in self.sync_routes:
            return self.sync_routes[path](request)
        if path.endswith("/embed"):
            if self.embed_handler is not None:
                return self.embed_handler(request)
            data = json.loads(request.content.decode("utf-8"))
            texts = data.get("texts", [])
            return httpx.Response(200, json={"vectors": [UNIT_VECTOR_768 for _ in texts]})
        return httpx.Response(404, json={"detail": f"Not found: {path}"})

    async def async_handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path in self.async_routes:
            res = self.async_routes[path](request)
            if asyncio.iscoroutine(res):
                return await res
            return res
        if path.endswith("/chat") and self.chat_handler is not None:
            res = self.chat_handler(request)
            if asyncio.iscoroutine(res):
                return await res
            return res
        if path.endswith("/embed"):
            if self.embed_handler is not None:
                res = self.embed_handler(request)
                if asyncio.iscoroutine(res):
                    return await res
                return res
            data = json.loads(request.content.decode("utf-8"))
            texts = data.get("texts", [])
            return httpx.Response(200, json={"vectors": [UNIT_VECTOR_768 for _ in texts]})
        return httpx.Response(404, json={"detail": f"Not found: {path}"})


@pytest.fixture
def n8n_mock() -> N8nMockDispatcher:
    return N8nMockDispatcher()


@pytest.fixture
def n8n_container(container: Container, n8n_mock: N8nMockDispatcher) -> Container:
    sync_transport = httpx.MockTransport(n8n_mock.sync_handler)
    async_transport = httpx.MockTransport(n8n_mock.async_handler)

    settings = N8nSettings(n8n_url="http://n8n.test")
    secret = SecretStr("test-secret")
    client = N8nClient(settings, secret, transport=sync_transport, async_transport=async_transport)

    analyzer = N8nAnalyzer(container.models, client)
    embedder = N8nEmbedder(client, "gemini-embedding-001")
    n8n_parts = N8nParts(client=client, analyzer=analyzer, embedder=embedder, secret=secret)

    result = dataclasses.replace(
        container,
        analyzer=analyzer,
        embedder=embedder,
        n8n=n8n_parts,
        chat_runs=None,
    )
    result.chat_runs = ChatRuns(result, build_n8n_chat_graph)
    return result
