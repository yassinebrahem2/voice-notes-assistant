import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.api.errors import ApiError, ErrorCode
from app.container import Container


def test_stub_route_returns_contract_shape(client: TestClient) -> None:
    response = client.get("/api/v1/recordings")
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

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/crash")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "private-value" not in response.text
    assert "private-value" not in caplog.text
    assert any(record.levelno >= logging.ERROR for record in caplog.records)


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
