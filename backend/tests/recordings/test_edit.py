from collections.abc import Sequence
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import Container
from app.db.connection import connect
from app.domain.types import RecordingStatus
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


def _set_failed(container: Container, rec_id: str, failed_step: str | None, *, claimed: bool = False) -> None:
    _rows(
        container,
        "UPDATE recordings SET status = 'failed', failed_step = ?, error_code = 'transcription_failed', "
        "error_message = 'Step failed.', claimed = ? WHERE id = ?",
        (failed_step, 1 if claimed else 0, rec_id),
    )


def _count(container: Container, sql: str, params: Sequence[str]) -> int:
    (value,) = _rows(container, sql, params)[0].values()
    assert isinstance(value, int)
    return value


def _recording_row(container: Container, rec_id: str) -> dict[str, object]:
    return _rows(container, "SELECT * FROM recordings WHERE id = ?", [rec_id])[0]


def _speaker_ids(container: Container, rec_id: str) -> dict[str, str]:
    rows = _rows(container, "SELECT label, id FROM speakers WHERE recording_id = ?", [rec_id])
    return {str(row["label"]): str(row["id"]) for row in rows}


def _tag_names(client: TestClient, rec_id: str) -> list[str]:
    return [tag["name"] for tag in client.get(f"/api/v1/recordings/{rec_id}").json()["tags"]]


def _make_files(data_dir: Path, rec_id: str) -> tuple[Path, Path]:
    audio = data_dir / "audio" / f"{rec_id}.m4a"
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(b"audio")
    tmp = data_dir / "tmp" / rec_id
    tmp.mkdir(parents=True)
    (tmp / "audio.npy").write_bytes(b"decoded")
    return audio, tmp


def _assert_error(response_json: dict[str, dict[str, str]], code: str) -> None:
    assert response_json["error"]["code"] == code


# PATCH /recordings/{id}


def test_patch_title_and_tags_reuses_existing(client: TestClient, container: Container) -> None:
    _seed(container, tags=["budget"])
    rec_id = _seed(container, title="Old title")

    response = client.patch(
        f"/api/v1/recordings/{rec_id}", json={"title": "  Planning call  ", "tags": ["Budgets ", "budget"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Planning call"
    assert [tag["name"] for tag in body["tags"]] == ["budget"]
    assert body["tags"][0]["count"] == 2
    assert _count(container, "SELECT COUNT(*) FROM tags WHERE name LIKE ?", ["budget%"]) == 1
    assert client.get(f"/api/v1/recordings/{rec_id}").json()["title"] == "Planning call"


def test_patch_tags_replace_set_and_keep_unused_tag_rows(client: TestClient, container: Container) -> None:
    rec_id = _seed(container, tags=["old"])

    response = client.patch(f"/api/v1/recordings/{rec_id}", json={"tags": ["Q3 Plan", "q3 plan", "Launch"]})

    assert response.status_code == 200
    assert [tag["name"] for tag in response.json()["tags"]] == ["launch", "q3-plan"]
    assert response.json()["title"] == "Budget sync"
    assert _count(container, "SELECT COUNT(*) FROM tags WHERE name = ?", ["old"]) == 1
    assert _count(container, "SELECT COUNT(*) FROM recording_tags WHERE recording_id = ?", [rec_id]) == 2


def test_patch_new_names_matching_each_other_create_one_tag(client: TestClient, container: Container) -> None:
    rec_id = _seed(container)

    response = client.patch(f"/api/v1/recordings/{rec_id}", json={"tags": ["Budget", "budgets"]})

    assert response.status_code == 200
    assert [tag["name"] for tag in response.json()["tags"]] == ["budget"]
    assert _count(container, "SELECT COUNT(*) FROM tags WHERE name LIKE ?", ["budget%"]) == 1


def test_patch_omitted_fields_are_unchanged(client: TestClient, container: Container) -> None:
    rec_id = _seed(container, title="Keep me", tags=["alpha"])

    assert client.patch(f"/api/v1/recordings/{rec_id}", json={}).status_code == 200
    assert client.patch(f"/api/v1/recordings/{rec_id}", json={"title": None, "tags": None}).status_code == 200

    detail = client.get(f"/api/v1/recordings/{rec_id}").json()
    assert detail["title"] == "Keep me"
    assert [tag["name"] for tag in detail["tags"]] == ["alpha"]


def test_patch_empty_tag_list_clears_tags(client: TestClient, container: Container) -> None:
    rec_id = _seed(container, tags=["alpha", "beta"])

    response = client.patch(f"/api/v1/recordings/{rec_id}", json={"tags": []})

    assert response.status_code == 200
    assert response.json()["tags"] == []
    assert _count(container, "SELECT COUNT(*) FROM tags", []) == 2


@pytest.mark.parametrize("body", [{"title": ""}, {"title": "   "}, {"title": "New", "tags": ["ok", "   "]}])
def test_patch_blank_title_or_tag_is_422_and_changes_nothing(
    client: TestClient, container: Container, body: dict[str, object]
) -> None:
    rec_id = _seed(container, title="Keep me", tags=["alpha"])

    response = client.patch(f"/api/v1/recordings/{rec_id}", json=body)

    assert response.status_code == 422
    _assert_error(response.json(), "validation_error")
    detail = client.get(f"/api/v1/recordings/{rec_id}").json()
    assert detail["title"] == "Keep me"
    assert [tag["name"] for tag in detail["tags"]] == ["alpha"]
    assert _count(container, "SELECT COUNT(*) FROM tags", []) == 1


@pytest.mark.parametrize("status", ["uploaded", "transcribing", "indexing", "failed"])
def test_patch_not_ready_is_409(client: TestClient, container: Container, status: RecordingStatus) -> None:
    rec_id = _seed(container, status=status, title="Keep me", tags=["alpha"])

    response = client.patch(f"/api/v1/recordings/{rec_id}", json={"title": "New", "tags": ["beta"]})

    assert response.status_code == 409
    _assert_error(response.json(), "not_ready")
    assert _recording_row(container, rec_id)["title"] == "Keep me"
    assert _tag_names(client, rec_id) == ["alpha"]
    assert _count(container, "SELECT COUNT(*) FROM tags WHERE name = ?", ["beta"]) == 0


def test_patch_unknown_recording_is_404(client: TestClient) -> None:
    response = client.patch("/api/v1/recordings/rec_missing", json={"title": "New"})

    assert response.status_code == 404
    _assert_error(response.json(), "not_found")


# PATCH /recordings/{id}/speakers/{speaker_id}


def test_rename_then_detail_shows_name(client: TestClient, container: Container) -> None:
    rec_id = _seed(container)
    speaker_id = _speaker_ids(container, rec_id)["A"]

    response = client.patch(f"/api/v1/recordings/{rec_id}/speakers/{speaker_id}", json={"name": "  Sarah "})

    assert response.status_code == 200
    assert response.json() == {"id": speaker_id, "label": "A", "name": "Sarah", "display_name": "Sarah"}
    speakers = {s["id"]: s for s in client.get(f"/api/v1/recordings/{rec_id}").json()["speakers"]}
    assert speakers[speaker_id]["name"] == "Sarah"
    assert speakers[speaker_id]["display_name"] == "Sarah"


@pytest.mark.parametrize("name", ["", "   "])
def test_rename_empty_clears(client: TestClient, container: Container, name: str) -> None:
    rec_id = _seed(container)
    speaker_id = _speaker_ids(container, rec_id)["A"]
    client.patch(f"/api/v1/recordings/{rec_id}/speakers/{speaker_id}", json={"name": "Sarah"})

    response = client.patch(f"/api/v1/recordings/{rec_id}/speakers/{speaker_id}", json={"name": name})

    assert response.status_code == 200
    assert response.json()["name"] is None
    assert response.json()["display_name"] == "Speaker A"
    speakers = {s["id"]: s for s in client.get(f"/api/v1/recordings/{rec_id}").json()["speakers"]}
    assert speakers[speaker_id]["name"] is None


def test_rename_other_recordings_speaker_is_404(client: TestClient, container: Container) -> None:
    rec_id = _seed(container)
    other_id = _seed(container)
    other_speaker = _speaker_ids(container, other_id)["A"]

    response = client.patch(f"/api/v1/recordings/{rec_id}/speakers/{other_speaker}", json={"name": "Sarah"})

    assert response.status_code == 404
    _assert_error(response.json(), "not_found")
    other = {s["id"]: s for s in client.get(f"/api/v1/recordings/{other_id}").json()["speakers"]}
    assert other[other_speaker]["name"] is None


def test_rename_unknown_speaker_or_recording_is_404(client: TestClient, container: Container) -> None:
    rec_id = _seed(container)
    speaker_id = _speaker_ids(container, rec_id)["A"]

    unknown_speaker = client.patch(f"/api/v1/recordings/{rec_id}/speakers/spk_missing", json={"name": "Sarah"})
    unknown_recording = client.patch(f"/api/v1/recordings/rec_missing/speakers/{speaker_id}", json={"name": "Sarah"})

    assert unknown_speaker.status_code == 404
    _assert_error(unknown_speaker.json(), "not_found")
    assert unknown_recording.status_code == 404
    _assert_error(unknown_recording.json(), "not_found")


def test_rename_not_ready_is_409(client: TestClient, container: Container) -> None:
    rec_id = _seed(container, status="analyzing")
    speaker_id = _speaker_ids(container, rec_id)["A"]

    response = client.patch(f"/api/v1/recordings/{rec_id}/speakers/{speaker_id}", json={"name": "Sarah"})

    assert response.status_code == 409
    _assert_error(response.json(), "not_ready")
    speakers = {s["id"]: s for s in client.get(f"/api/v1/recordings/{rec_id}").json()["speakers"]}
    assert speakers[speaker_id]["name"] is None


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


# POST /recordings/{id}/retry


@pytest.mark.parametrize(
    ("failed_step", "expected_status"),
    [
        ("decoding", "uploaded"),
        ("transcribing", "transcribing"),
        ("diarizing", "diarizing"),
        ("analyzing", "analyzing"),
        ("indexing", "indexing"),
    ],
)
def test_retry_maps_failed_step_to_status(
    client: TestClient, container: Container, failed_step: str, expected_status: str
) -> None:
    rec_id = _seed(container)
    _set_failed(container, rec_id, failed_step)

    response = client.post(f"/api/v1/recordings/{rec_id}/retry")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == rec_id
    assert body["status"] == expected_status
    assert body["failed_step"] is None
    assert body["error_code"] is None
    assert body["error_message"] is None
    assert body["processing"] is False
    row = _recording_row(container, rec_id)
    assert (row["status"], row["failed_step"], row["error_code"], row["error_message"], row["claimed"]) == (
        expected_status,
        None,
        None,
        None,
        0,
    )


def test_retry_resets_a_stale_claim(client: TestClient, container: Container) -> None:
    rec_id = _seed(container)
    _set_failed(container, rec_id, "analyzing", claimed=True)

    response = client.post(f"/api/v1/recordings/{rec_id}/retry")

    assert response.status_code == 200
    assert response.json()["processing"] is False
    assert _recording_row(container, rec_id)["claimed"] == 0


@pytest.mark.parametrize(("status", "claimed"), [("ready", False), ("transcribing", True), ("uploaded", False)])
def test_retry_not_failed_is_409(
    client: TestClient, container: Container, status: RecordingStatus, claimed: bool
) -> None:
    rec_id = _seed(container, status=status, claimed=claimed)
    before = _recording_row(container, rec_id)

    response = client.post(f"/api/v1/recordings/{rec_id}/retry")

    assert response.status_code == 409
    _assert_error(response.json(), "not_failed")
    assert _recording_row(container, rec_id) == before


def test_retry_failed_without_failed_step_is_409_and_unchanged(client: TestClient, container: Container) -> None:
    rec_id = _seed(container)
    _set_failed(container, rec_id, None)
    before = _recording_row(container, rec_id)

    response = client.post(f"/api/v1/recordings/{rec_id}/retry")

    assert response.status_code == 409
    _assert_error(response.json(), "not_failed")
    assert _recording_row(container, rec_id) == before


def test_retry_unknown_is_404(client: TestClient) -> None:
    response = client.post("/api/v1/recordings/rec_missing/retry")

    assert response.status_code == 404
    _assert_error(response.json(), "not_found")


# app.audio.storage (imported inside the tests so the endpoint tests above still run before the module exists)


def test_storage_paths_follow_the_data_layout(tmp_path: Path) -> None:
    from app.audio.storage import audio_path, tmp_dir

    assert audio_path(tmp_path, "rec_1", "m4a") == tmp_path / "audio" / "rec_1.m4a"
    assert tmp_dir(tmp_path, "rec_1") == tmp_path / "tmp" / "rec_1"


def test_remove_recording_files_tolerates_missing_files(tmp_path: Path) -> None:
    from app.audio.storage import remove_recording_files

    remove_recording_files(tmp_path, "rec_1", "m4a")

    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("rec_id", "ext"),
    [("..", "m4a"), (".", "m4a"), ("", "m4a"), ("../x", "m4a"), ("a\\b", "m4a"), ("rec_1", "../m4a"), ("rec_1", "")],
)
def test_remove_recording_files_rejects_path_like_names(tmp_path: Path, rec_id: str, ext: str) -> None:
    from app.audio.storage import remove_recording_files

    data_dir = tmp_path / "data"
    (data_dir / "tmp" / "rec_1").mkdir(parents=True)
    (data_dir / "tmp" / "rec_1" / "audio.npy").write_bytes(b"keep")
    sentinel = tmp_path / "x.m4a"
    sentinel.write_bytes(b"keep")

    with pytest.raises(ValueError):
        remove_recording_files(data_dir, rec_id, ext)

    assert (data_dir / "tmp" / "rec_1" / "audio.npy").read_bytes() == b"keep"
    assert sentinel.read_bytes() == b"keep"


def test_remove_recording_files_does_not_follow_a_symlinked_tmp_dir(tmp_path: Path) -> None:
    from app.audio.storage import remove_recording_files

    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "precious").write_bytes(b"keep")
    (tmp_path / "data" / "tmp").mkdir(parents=True)
    link = tmp_path / "data" / "tmp" / "rec_1"
    link.symlink_to(outside, target_is_directory=True)

    remove_recording_files(tmp_path / "data", "rec_1", "m4a")

    assert not link.exists()
    assert not link.is_symlink()
    assert (outside / "precious").read_bytes() == b"keep"
