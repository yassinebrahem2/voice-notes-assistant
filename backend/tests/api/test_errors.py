import asyncio
import logging
import traceback
from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.responses import StreamingResponse
from starlette.types import Message, Receive, Scope, Send

from app.api.app import create_app
from app.api.errors import ApiError, ErrorCode, SafeErrorMiddleware, not_implemented
from app.container import Container


def test_stub_route_returns_contract_shape(container: Container) -> None:
    app = create_app(container)

    @app.get("/stub")
    def stub() -> None:
        not_implemented()

    with TestClient(app) as client:
        response = client.get("/stub")
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "not_implemented"
    assert set(response.json()) == {"error"}


def test_validation_error_shape(client: TestClient) -> None:
    response = client.post("/api/v1/chats/cht_x/messages", json={"text": "", "scope": "both"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "detail" not in response.json()


def test_unknown_path_shape(client: TestClient) -> None:
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_unhandled_exception_is_generic(container: Container, caplog: pytest.LogCaptureFixture) -> None:
    app = create_app(container)

    @app.get("/crash")
    def crash() -> None:
        raise RuntimeError("private-value path /x")

    with TestClient(app) as client:
        response = client.get("/crash")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "private-value" not in response.text
    assert "private-value" not in caplog.text
    assert any(record.levelno >= logging.ERROR for record in caplog.records)
    assert "GET" in caplog.text
    assert "/crash" in caplog.text
    assert "RuntimeError" in caplog.text
    assert "test_errors.py" in caplog.text
    assert "in crash" in caplog.text


def test_unhandled_exception_logs_route_template(container: Container, caplog: pytest.LogCaptureFixture) -> None:
    app = create_app(container)

    @app.get("/items/{item_id}")
    def item(item_id: str) -> None:
        raise RuntimeError("private-value")

    with TestClient(app) as client:
        client.get("/items/abc123")
    assert "/items/{item_id}" in caplog.text
    assert "abc123" not in caplog.text


def test_unhandled_exception_is_handled_only_by_the_middleware(container: Container) -> None:
    app = create_app(container)
    assert Exception not in app.exception_handlers


def test_streaming_exception_does_not_expose_original(container: Container, caplog: pytest.LogCaptureFixture) -> None:
    app = create_app(container)
    private_message = "private-value path /x"

    async def stream() -> AsyncIterator[bytes]:
        yield b"partial response"
        raise RuntimeError(private_message)

    @app.get("/stream-crash")
    def stream_crash() -> StreamingResponse:
        return StreamingResponse(stream())

    with TestClient(app) as client, pytest.raises(RuntimeError, match=r"^Response failed\.$") as caught:
        client.get("/stream-crash")
    assert "private-value" not in "".join(traceback.format_exception(caught.value))
    assert "private-value" not in caplog.text
    assert "/stream-crash" in caplog.text
    assert "in stream" in caplog.text
    assert len([record for record in caplog.records if record.levelno >= logging.ERROR]) == 1


def test_error_middleware_does_not_swallow_lifespan_errors() -> None:
    async def fail_lifespan(scope: Scope, receive: Receive, send: Send) -> None:
        raise RuntimeError("startup failed")

    async def receive() -> Message:
        raise AssertionError("No event should be requested.")

    async def send(message: Message) -> None:
        raise AssertionError("No HTTP response should be sent.")

    with pytest.raises(RuntimeError, match="startup failed"):
        asyncio.run(SafeErrorMiddleware(fail_lifespan)({"type": "lifespan"}, receive, send))


def test_http_exception_is_sanitized(container: Container) -> None:
    app: FastAPI = create_app(container)

    @app.get("/http-error")
    def http_error() -> None:
        raise HTTPException(403, detail="private-value")

    with TestClient(app) as client:
        response = client.get("/http-error")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "internal_error"
    assert "private-value" not in response.text


def test_api_error_preserves_code(container: Container) -> None:
    app = create_app(container)

    @app.get("/busy")
    def busy() -> None:
        raise ApiError(409, ErrorCode.recording_busy, "Recording is being processed.")

    with TestClient(app) as client:
        response = client.get("/busy")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "recording_busy"
