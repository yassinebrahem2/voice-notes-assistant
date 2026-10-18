import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.container import Container

ROUTES = [
    ("get", "/health"),
    ("get", "/recordings"),
    ("post", "/recordings"),
    ("get", "/recordings/{id}"),
    ("patch", "/recordings/{id}"),
    ("delete", "/recordings/{id}"),
    ("patch", "/recordings/{id}/speakers/{speaker_id}"),
    ("post", "/recordings/{id}/retry"),
    ("get", "/recordings/{id}/audio"),
    ("get", "/tags"),
    ("post", "/chats"),
    ("get", "/chats/{chat_id}"),
    ("post", "/chats/{chat_id}/messages"),
    ("get", "/chats/{chat_id}/runs/{run_id}"),
    ("post", "/chats/{chat_id}/runs/{run_id}/retry"),
]


def test_routes_exist(container: Container) -> None:
    schema = create_app(container).openapi()
    operation_ids: list[str] = []
    for method, path in ROUTES:
        operation = schema["paths"][f"/api/v1{path}"][method]
        operation_ids.append(operation["operationId"])
        assert operation["responses"]["422"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorOut")
    assert len(set(operation_ids)) == len(ROUTES)


STUBS = [
    ("get", "/recordings"),
    ("post", "/recordings"),
    ("get", "/recordings/{id}"),
    ("patch", "/recordings/{id}"),
    ("delete", "/recordings/{id}"),
    ("patch", "/recordings/{id}/speakers/{speaker_id}"),
    ("post", "/recordings/{id}/retry"),
    ("get", "/recordings/{id}/audio"),
    ("get", "/tags"),
]


@pytest.mark.parametrize(("method", "path"), STUBS)
def test_every_stub_returns_501(client: TestClient, method: str, path: str) -> None:
    url = "/api/v1" + path.format(id="rec_x", speaker_id="spk_x")
    if method == "post" and path == "/recordings":
        response = client.post(
            url, data={"kind": "meeting", "client_upload_id": "upload-x"}, files={"file": ("test.m4a", b"audio")}
        )
    elif method == "patch":
        body = {"name": "Sarah"} if "speakers" in path else {"title": "Meeting"}
        response = client.patch(url, json=body)
    else:
        response = client.request(method, url)
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "not_implemented"


def test_audio_and_upload_openapi(container: Container) -> None:
    paths = create_app(container).openapi()["paths"]
    upload = paths["/api/v1/recordings"]["post"]
    assert "multipart/form-data" in upload["requestBody"]["content"]
    assert {"200", "201"}.issubset(upload["responses"])
    audio = paths["/api/v1/recordings/{id}/audio"]["get"]
    for status in ("200", "206"):
        assert "audio/*" in audio["responses"][status]["content"]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/recordings/rec_x", {"title": "x" * 61}),
        ("/recordings/rec_x", {"tags": ["a", "b", "c", "d", "e"]}),
        ("/recordings/rec_x/speakers/spk_x", {"name": "x" * 41}),
    ],
)
def test_patch_constraints(client: TestClient, path: str, body: dict[str, object]) -> None:
    assert client.patch("/api/v1" + path, json=body).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"text": "x" * 2001, "scope": "both"},
        {"text": "Valid question", "scope": "invalid"},
    ],
)
def test_ask_constraints(client: TestClient, body: dict[str, str]) -> None:
    response = client.post("/api/v1/chats/cht_x/messages", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
