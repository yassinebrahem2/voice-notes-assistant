from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.container import Container
from app.db.connection import connect
from tests.seed import seed_recording

AUDIO = bytes(range(256)) * 40


def _seed_with_file(container: Container, ext: str = "m4a", *, write_file: bool = True) -> str:
    with closing(connect(container.db_path)) as conn, conn:
        rec_id = seed_recording(conn)
        conn.execute("UPDATE recordings SET audio_ext = ? WHERE id = ?", (ext, rec_id))
    if write_file:
        path = container.settings.data_dir / "audio" / f"{rec_id}.{ext}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(AUDIO)
    return rec_id


def test_audio_range_returns_206_with_content_range(client: TestClient, container: Container) -> None:
    rec_id = _seed_with_file(container)

    response = client.get(f"/api/v1/recordings/{rec_id}/audio", headers={"Range": "bytes=100-299"})

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes 100-299/{len(AUDIO)}"
    assert response.headers["content-type"] == "audio/mp4"
    assert response.content == AUDIO[100:300]


def test_audio_full_200(client: TestClient, container: Container) -> None:
    rec_id = _seed_with_file(container)

    response = client.get(f"/api/v1/recordings/{rec_id}/audio")

    assert response.status_code == 200
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-type"] == "audio/mp4"
    assert response.content == AUDIO


@pytest.mark.parametrize(
    ("ext", "media_type"),
    [("m4a", "audio/mp4"), ("mp4", "audio/mp4"), ("aac", "audio/mp4"), ("wav", "audio/wav"), ("mp3", "audio/mpeg")],
)
def test_audio_media_type_follows_extension(
    client: TestClient, container: Container, ext: str, media_type: str
) -> None:
    rec_id = _seed_with_file(container, ext)

    response = client.get(f"/api/v1/recordings/{rec_id}/audio")

    assert response.status_code == 200
    assert response.headers["content-type"] == media_type


def test_audio_missing_404(client: TestClient) -> None:
    response = client.get("/api/v1/recordings/rec_missing/audio")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_audio_file_missing_404(client: TestClient, container: Container) -> None:
    rec_id = _seed_with_file(container, write_file=False)

    response = client.get(f"/api/v1/recordings/{rec_id}/audio")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
