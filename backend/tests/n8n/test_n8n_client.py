import asyncio
import json
import os

import httpx
import pytest
from pydantic import HttpUrl, SecretStr

from app.config.models_registry import LlmEntry, LocalModel, ModelsRegistry, Provider, Roles
from app.n8n.client import N8nBadResponse, N8nClient, N8nUnavailable, first_gemini_entry
from app.n8n.settings import N8nSettings


@pytest.fixture(autouse=True)
def clean_n8n_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in tuple(os.environ):
        if key.startswith("N8N_") or key == "AI_BACKEND":
            monkeypatch.delenv(key, raising=False)


def test_client_timeouts() -> None:
    settings = N8nSettings(n8n_timeout_s=60.0)
    client = N8nClient(settings, SecretStr("test-secret"))
    try:
        assert client.sync_client.timeout == httpx.Timeout(60.0)
        assert client.async_client.timeout == httpx.Timeout(None)
    finally:
        client.close()


def test_post_sends_secret_header_and_json() -> None:
    captured_request: httpx.Request | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_request
        captured_request = request
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    try:
        reply = client.post("analyze", {"prompt": "hello", "count": 1})
        assert reply == {"ok": True}
        assert captured_request is not None
        assert captured_request.method == "POST"
        assert str(captured_request.url) == "http://n8n.test/webhook/analyze"
        assert captured_request.headers.get("X-N8N-Secret") == "test-secret"
        assert json.loads(captured_request.content.decode("utf-8")) == {"prompt": "hello", "count": 1}
    finally:
        client.close()


def test_post_unwraps_output() -> None:
    responses = [
        httpx.Response(200, json={"output": {"a": 1}}),
        httpx.Response(200, json={"a": 1}),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return responses.pop(0)

    transport = httpx.MockTransport(handler)
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    try:
        res1 = client.post("test", {})
        assert res1 == {"a": 1}
        res2 = client.post("test", {})
        assert res2 == {"a": 1}
    finally:
        client.close()


@pytest.mark.parametrize(
    ("handler_or_exc", "is_404"),
    [
        (httpx.ConnectError("Connection failed"), False),
        (httpx.ReadTimeout("Read timed out"), False),
        (httpx.Response(500, text="Internal Server Error"), False),
        (httpx.Response(404, text="Workflow not found"), True),
    ],
)
def test_unavailable_errors(
    handler_or_exc: Exception | httpx.Response,
    is_404: bool,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if isinstance(handler_or_exc, Exception):
            raise handler_or_exc
        return handler_or_exc

    transport = httpx.MockTransport(handler)
    settings = N8nSettings(n8n_url="http://n8n.test")
    val = "test-secret"
    client = N8nClient(settings, SecretStr(val), transport=transport)
    try:
        with pytest.raises(N8nUnavailable) as exc_info:
            client.post("workflow_test", {})

        err_msg = str(exc_info.value)
        assert val not in err_msg
        assert val not in caplog.text

        if is_404:
            assert "not active" in caplog.text
    finally:
        client.close()


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(400, text="Bad Request"),
        httpx.Response(200, text="not valid json"),
        httpx.Response(200, json=[1, 2, 3]),
        httpx.Response(200, json="a string"),
    ],
)
def test_bad_response(response: httpx.Response) -> None:
    transport = httpx.MockTransport(lambda req: response)
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    try:
        with pytest.raises(N8nBadResponse):
            client.post("test", {})
    finally:
        client.close()


def test_apost_same_mapping() -> None:
    async def run() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/ok"):
                return httpx.Response(200, json={"output": {"success": True}})
            if request.url.path.endswith("/error"):
                return httpx.Response(503, text="Service Unavailable")
            return httpx.Response(400, text="Bad Request")

        transport = httpx.MockTransport(handler)
        settings = N8nSettings(n8n_url="http://n8n.test")
        client = N8nClient(settings, SecretStr("test-secret"), async_transport=transport)
        try:
            res = await client.apost("ok", {"ping": 1})
            assert res == {"success": True}

            with pytest.raises(N8nUnavailable):
                await client.apost("error", {})

            with pytest.raises(N8nBadResponse):
                await client.apost("bad", {})
        finally:
            await client.aclose()

    asyncio.run(run())


def test_first_gemini_entry() -> None:
    registry = ModelsRegistry(
        providers={
            "groq": Provider(
                client="openai", base_url=HttpUrl("https://api.groq.com/openai/v1"), key_env="GROQ_API_KEY"
            ),
            "gemini": Provider(client="google_genai", key_env="GEMINI_API_KEY"),
        },
        roles=Roles(
            llm=[
                LlmEntry(provider="groq", model="groq-model", max_request_tokens=1000, timeout_s=30),
                LlmEntry(provider="gemini", model="gemini-flash", max_request_tokens=2000, timeout_s=30),
            ],
            llm_analysis=[
                LlmEntry(provider="groq", model="groq-analysis", max_request_tokens=1000, timeout_s=30),
            ],
            embedder=LocalModel(model="bge", device="cpu"),
            asr=LocalModel(model="asr", device="cpu"),
            diarizer=LocalModel(model="diar", device="cpu"),
        ),
    )
    entry = first_gemini_entry(registry, registry.roles.llm)
    assert entry is not None
    assert entry.provider == "gemini"
    assert entry.model == "gemini-flash"

    no_gemini = first_gemini_entry(registry, registry.roles.llm_analysis)
    assert no_gemini is None
