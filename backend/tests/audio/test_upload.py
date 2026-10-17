import io
import re
import sqlite3
from collections.abc import Callable
from contextlib import closing
from pathlib import Path

import httpx2
import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

from app.api.models.recordings import RecordingOut
from app.container import Container
from app.db.connection import connect
from tests.fixtures.audio_gen import sine_wav

UPLOAD_URL = "/api/v1/recordings"


@pytest.fixture
def wav_bytes(tmp_path: Path) -> bytes:
    return sine_wav(tmp_path / "source.wav").read_bytes()


@pytest.fixture
def wakes(monkeypatch: pytest.MonkeyPatch) -> list[Container]:
    calls: list[Container] = []
    monkeypatch.setattr("app.api.routes.recordings.wake_worker", calls.append)
    return calls


def _post(client: TestClient, data: bytes, *, filename: str = "voice.wav") -> httpx2.Response:
    return client.post(
        UPLOAD_URL,
        data={"kind": "meeting", "client_upload_id": "upload-1"},
        files={"file": (filename, data, "application/octet-stream")},
    )


def _rows(container: Container) -> list[dict[str, object]]:
    with closing(connect(container.db_path)) as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM recordings")]


def _files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*") if path.is_file()) if directory.exists() else []


def _audio_files(container: Container) -> list[Path]:
    return _files(container.settings.data_dir / "audio")


def _upload_temps(container: Container) -> list[Path]:
    return sorted((container.settings.data_dir / "tmp").glob("upload-*"))


def _assert_error(body: dict[str, dict[str, str]], code: str) -> None:
    assert body["error"]["code"] == code


def _insert_conflict(container: Container, *, rec_id: str, client_upload_id: str) -> None:
    with closing(connect(container.db_path)) as conn, conn:
        conn.execute(
            "INSERT INTO recordings (id, kind, client_upload_id, status, created_at, audio_ext) "
            "VALUES (?, 'note', ?, 'uploaded', '2026-10-17T00:00:00Z', 'wav')",
            (rec_id, client_upload_id),
        )


def _after_copy(monkeypatch: pytest.MonkeyPatch, hook: Callable[[str], None]) -> None:
    # audio_path is looked up once the temp copy is complete and before the move and the insert.
    from app.audio import upload

    original = upload.audio_path

    def wrapped(data_dir: Path, rec_id: str, ext: str) -> Path:
        hook(rec_id)
        return original(data_dir, rec_id, ext)

    monkeypatch.setattr(upload, "audio_path", wrapped)


# Through the endpoint


def test_upload_creates_recording_201(
    client: TestClient, container: Container, wav_bytes: bytes, wakes: list[Container]
) -> None:
    response = _post(client, wav_bytes)

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "meeting"
    assert body["status"] == "uploaded"
    assert body["title"] is None
    assert body["processing"] is False
    (row,) = _rows(container)
    assert row["id"] == body["id"]
    assert row["client_upload_id"] == "upload-1"
    assert row["audio_ext"] == "wav"
    assert row["claimed"] == 0
    assert row["title"] is None
    assert isinstance(row["created_at"], str)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", row["created_at"])
    stored = container.settings.data_dir / "audio" / f"{body['id']}.wav"
    assert _audio_files(container) == [stored]
    assert stored.read_bytes() == wav_bytes
    assert _upload_temps(container) == []
    assert wakes == [container]


def test_upload_same_client_id_returns_existing_200(
    client: TestClient, container: Container, wav_bytes: bytes, wakes: list[Container]
) -> None:
    first = _post(client, wav_bytes)
    retry = _post(client, wav_bytes)

    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.json() == first.json()
    assert len(_rows(container)) == 1
    assert len(_audio_files(container)) == 1
    assert _upload_temps(container) == []
    assert wakes == [container]


def test_concurrent_duplicate_client_id_keeps_one_file(
    client: TestClient, container: Container, wav_bytes: bytes, monkeypatch: pytest.MonkeyPatch, wakes: list[Container]
) -> None:
    other_id = "rec_01J00000000000000000000000"
    other_file = container.settings.data_dir / "audio" / f"{other_id}.wav"
    attempted: list[str] = []

    def other_request_wins(rec_id: str) -> None:
        attempted.append(rec_id)
        other_file.parent.mkdir(parents=True, exist_ok=True)
        other_file.write_bytes(b"the other request's audio")
        _insert_conflict(container, rec_id=other_id, client_upload_id="upload-1")

    _after_copy(monkeypatch, other_request_wins)

    response = _post(client, wav_bytes)

    assert response.status_code == 200
    assert response.json()["id"] == other_id
    assert [row["id"] for row in _rows(container)] == [other_id]
    assert len(attempted) == 1
    assert not (container.settings.data_dir / "audio" / f"{attempted[0]}.wav").exists()
    assert _audio_files(container) == [other_file]
    assert other_file.read_bytes() == b"the other request's audio"
    assert _upload_temps(container) == []
    assert wakes == []


def test_upload_too_large_413_leaves_nothing(
    client: TestClient, container: Container, wav_bytes: bytes, monkeypatch: pytest.MonkeyPatch, wakes: list[Container]
) -> None:
    monkeypatch.setattr(container, "settings", container.settings.model_copy(update={"upload_max_bytes": 1000}))

    response = _post(client, wav_bytes)

    assert response.status_code == 413
    _assert_error(response.json(), "payload_too_large")
    assert _rows(container) == []
    assert _audio_files(container) == []
    assert _files(container.settings.data_dir / "tmp") == []
    assert wakes == []


def test_upload_at_exact_limit_is_accepted(
    client: TestClient, container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(container, "settings", container.settings.model_copy(update={"upload_max_bytes": 1000}))

    assert _post(client, b"x" * 1000).status_code == 201


@pytest.mark.parametrize("filename", ["notes.txt", "voice", "voice.m4a.exe", "../../voice.ogg"])
def test_upload_unknown_extension_415(
    client: TestClient, container: Container, wav_bytes: bytes, filename: str, wakes: list[Container]
) -> None:
    response = _post(client, wav_bytes, filename=filename)

    assert response.status_code == 415
    _assert_error(response.json(), "unsupported_media_type")
    assert _rows(container) == []
    assert _audio_files(container) == []
    assert _files(container.settings.data_dir / "tmp") == []
    assert wakes == []


def test_upload_extension_is_case_insensitive_and_ignores_the_name(
    client: TestClient, container: Container, wav_bytes: bytes
) -> None:
    response = _post(client, wav_bytes, filename="../../My Voice.M4A")

    assert response.status_code == 201
    (row,) = _rows(container)
    assert row["audio_ext"] == "m4a"
    assert _audio_files(container) == [container.settings.data_dir / "audio" / f"{row['id']}.m4a"]


# Directly against store_upload, for failures the endpoint cannot provoke


def _upload_file(data: bytes, filename: str | None = "voice.wav") -> UploadFile:
    return UploadFile(io.BytesIO(data), filename=filename)


def _store(container: Container, conn: sqlite3.Connection, file: UploadFile) -> tuple[RecordingOut, bool]:
    from app.audio.upload import store_upload

    return store_upload(
        conn,
        container.settings.data_dir,
        kind="note",
        client_upload_id="upload-1",
        file=file,
        max_bytes=container.settings.upload_max_bytes,
    )


def test_store_upload_without_filename_415(container: Container, wav_bytes: bytes) -> None:
    from app.api.errors import ApiError

    with closing(connect(container.db_path)) as conn, pytest.raises(ApiError) as caught:
        _store(container, conn, _upload_file(wav_bytes, filename=None))

    assert caught.value.status == 415
    assert _rows(container) == []


def test_store_upload_other_integrity_error_reraises_and_cleans_up(
    container: Container, wav_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempted: list[str] = []

    def take_the_id(rec_id: str) -> None:
        # Same primary key, different client_upload_id: an IntegrityError that is not a duplicate upload.
        attempted.append(rec_id)
        _insert_conflict(container, rec_id=rec_id, client_upload_id="someone-else")

    _after_copy(monkeypatch, take_the_id)

    with closing(connect(container.db_path)) as conn, pytest.raises(sqlite3.IntegrityError):
        _store(container, conn, _upload_file(wav_bytes))

    assert [row["client_upload_id"] for row in _rows(container)] == ["someone-else"]
    assert _audio_files(container) == []
    assert _upload_temps(container) == []
    assert len(attempted) == 1


def test_store_upload_insert_failure_reraises_and_removes_file(container: Container, wav_bytes: bytes) -> None:
    with closing(connect(container.db_path)) as conn:
        conn.execute("PRAGMA query_only = ON")
        with pytest.raises(sqlite3.OperationalError):
            _store(container, conn, _upload_file(wav_bytes))

    assert _rows(container) == []
    assert _audio_files(container) == []
    assert _upload_temps(container) == []


def test_store_upload_move_failure_reraises_and_removes_temp(container: Container, wav_bytes: bytes) -> None:
    # A plain file where the audio directory should be makes the move fail after the copy.
    (container.settings.data_dir / "audio").write_bytes(b"")

    with closing(connect(container.db_path)) as conn, pytest.raises(FileExistsError):
        _store(container, conn, _upload_file(wav_bytes))

    assert _rows(container) == []
    assert _upload_temps(container) == []
