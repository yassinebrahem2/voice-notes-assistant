import re
from collections.abc import Sequence
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.errors import ApiError, ErrorCode
from app.container import Container
from app.db.connection import connect
from app.domain.types import RecordingStatus
from app.recordings import edit
from tests.seed import seed_chunk, seed_recording


def _seed(
    container: Container,
    *,
    status: RecordingStatus = "ready",
    title: str | None = "Budget sync",
    tags: Sequence[str] = (),
    claimed: bool = False,
) -> str:
    with closing(connect(container.db_path)) as conn:
        return seed_recording(conn, status=status, title=title, tags=tags, claimed=claimed)


def _rows(container: Container, sql: str, params: Sequence[str | int | None] = ()) -> list[dict[str, object]]:
    with closing(connect(container.db_path)) as conn, conn:
        return [dict(row) for row in conn.execute(sql, tuple(params))]


def _count(container: Container, sql: str, params: Sequence[str]) -> int:
    (value,) = _rows(container, sql, params)[0].values()
    assert isinstance(value, int)
    return value


def _assert_error(response_json: dict[str, dict[str, str]], code: str) -> None:
    assert response_json["error"]["code"] == code


def _make_files(data_dir: Path, rec_id: str) -> tuple[Path, Path]:
    audio = data_dir / "audio" / f"{rec_id}.m4a"
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(b"audio")
    tmp = data_dir / "tmp" / rec_id
    tmp.mkdir(parents=True)
    (tmp / "audio.npy").write_bytes(b"decoded")
    return audio, tmp


# DELETE /recordings/{id}

_OWNED_ROWS = {
    "recordings": "SELECT COUNT(*) FROM recordings WHERE id = ?",
    "speakers": "SELECT COUNT(*) FROM speakers WHERE recording_id = ?",
    "segments": "SELECT COUNT(*) FROM segments WHERE recording_id = ?",
    "chunks": "SELECT COUNT(*) FROM chunks WHERE recording_id = ?",
    "recording_tags": "SELECT COUNT(*) FROM recording_tags WHERE recording_id = ?",
}


def _owned_counts(container: Container, rec_id: str) -> dict[str, int]:
    return {table: _count(container, sql, [rec_id]) for table, sql in _OWNED_ROWS.items()}


def _seed_with_chunk(container: Container, *, status: RecordingStatus = "ready", claimed: bool = False) -> str:
    rec_id = _seed(container, status=status, tags=["budget"], claimed=claimed)
    with closing(connect(container.db_path)) as conn:
        seed_chunk(conn, rec_id, first_idx=0, last_idx=1, text="chunk text", vector=[0.1] * 4)
    return rec_id


def test_delete_removes_rows_and_files(client: TestClient, container: Container) -> None:
    data_dir = container.settings.data_dir
    rec_id = _seed_with_chunk(container)
    other_id = _seed_with_chunk(container)
    audio, tmp = _make_files(data_dir, rec_id)
    other_audio, other_tmp = _make_files(data_dir, other_id)

    response = client.delete(f"/api/v1/recordings/{rec_id}")

    assert response.status_code == 204
    assert response.content == b""
    assert _owned_counts(container, rec_id) == dict.fromkeys(_OWNED_ROWS, 0)
    assert not audio.exists()
    assert not tmp.exists()
    assert _count(container, "SELECT COUNT(*) FROM tags WHERE name = ?", ["budget"]) == 1
    assert client.get(f"/api/v1/recordings/{rec_id}").status_code == 404
    assert _owned_counts(container, other_id) == {
        "recordings": 1,
        "speakers": 2,
        "segments": 2,
        "chunks": 1,
        "recording_tags": 1,
    }
    assert other_audio.read_bytes() == b"audio"
    assert (other_tmp / "audio.npy").read_bytes() == b"decoded"


@pytest.mark.parametrize("status", ["uploaded", "failed", "ready"])
def test_delete_unclaimed_recording_without_files_succeeds(
    client: TestClient, container: Container, status: RecordingStatus
) -> None:
    rec_id = _seed(container, status=status)

    response = client.delete(f"/api/v1/recordings/{rec_id}")

    assert response.status_code == 204
    assert _count(container, "SELECT COUNT(*) FROM recordings WHERE id = ?", [rec_id]) == 0


def test_delete_claimed_is_409_and_keeps_everything(client: TestClient, container: Container) -> None:
    data_dir = container.settings.data_dir
    rec_id = _seed_with_chunk(container, status="transcribing", claimed=True)
    audio, tmp = _make_files(data_dir, rec_id)
    before = _owned_counts(container, rec_id)

    response = client.delete(f"/api/v1/recordings/{rec_id}")

    assert response.status_code == 409
    _assert_error(response.json(), "recording_busy")
    assert _owned_counts(container, rec_id) == before
    assert before["recordings"] == 1
    assert before["chunks"] == 1
    assert audio.read_bytes() == b"audio"
    assert (tmp / "audio.npy").read_bytes() == b"decoded"


def test_delete_claimed_decides_on_the_guarded_delete_alone(container: Container) -> None:
    data_dir = container.settings.data_dir
    rec_id = _seed(container, status="transcribing", claimed=True)
    audio, tmp = _make_files(data_dir, rec_id)
    statements: list[str] = []

    with closing(connect(container.db_path)) as conn:
        conn.set_trace_callback(lambda sql: statements.append(" ".join(sql.split())))
        with pytest.raises(ApiError) as raised:
            edit.delete_recording(conn, data_dir, rec_id)

    assert raised.value.code == ErrorCode.recording_busy
    # A separate read of `claimed` before the delete would race the worker's claim.
    touching = [sql for sql in statements if "recordings" in sql.lower()]
    assert re.match(r"DELETE FROM recordings WHERE id = \S+ AND claimed = 0\b", touching[0], re.IGNORECASE)
    assert not any("claimed" in sql.lower() for sql in touching[1:])
    assert audio.read_bytes() == b"audio"
    assert (tmp / "audio.npy").read_bytes() == b"decoded"


def test_delete_unknown_is_404(client: TestClient) -> None:
    response = client.delete("/api/v1/recordings/rec_missing")

    assert response.status_code == 404
    _assert_error(response.json(), "not_found")


@pytest.mark.parametrize("path_text", ["..", "%2E%2E", "..%2F..%2Fsentinel", "..%5C..%5Csentinel"])
def test_delete_path_like_id_in_url_touches_no_files(client: TestClient, container: Container, path_text: str) -> None:
    data_dir = container.settings.data_dir
    sentinel = data_dir.parent / "sentinel"
    sentinel.write_bytes(b"keep")
    (data_dir / "tmp").mkdir()
    (data_dir / "tmp" / "keep.npy").write_bytes(b"keep")

    response = client.delete(f"/api/v1/recordings/{path_text}")

    assert response.status_code == 404
    assert sentinel.read_bytes() == b"keep"
    assert (data_dir / "tmp" / "keep.npy").read_bytes() == b"keep"
    assert (data_dir / "app.db").exists()
