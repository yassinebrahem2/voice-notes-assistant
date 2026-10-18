"""Write-side operations behind the recording edit, delete and retry endpoints."""

import sqlite3
from pathlib import Path

from app.api.errors import ApiError, ErrorCode
from app.api.models.recordings import RecordingOut, RecordingPatchIn, SpeakerOut, SpeakerPatchIn
from app.audio.storage import remove_recording_files
from app.domain.speakers import display_name
from app.domain.tags import match_existing_tag, normalize_tag
from app.ids import new_id
from app.recordings.read import recording_out

# One statement, so the worker's claim and this retry cannot interleave. A failed row without a failed_step
# has no step to resume at, so it is left as it is rather than given an invented status.
_RETRY_SQL = """
UPDATE recordings
SET status = CASE failed_step WHEN 'decoding' THEN 'uploaded' ELSE failed_step END,
    failed_step = NULL, error_code = NULL, error_message = NULL, claimed = 0
WHERE id = ? AND status = 'failed' AND failed_step IS NOT NULL
"""


def _not_found() -> ApiError:
    return ApiError(404, ErrorCode.not_found, "Recording not found.")


def _status(conn: sqlite3.Connection, rec_id: str) -> str | None:
    row = conn.execute("SELECT status FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    return row["status"] if row is not None else None


def _not_ready_or_missing(conn: sqlite3.Connection, rec_id: str) -> ApiError:
    if _status(conn, rec_id) is None:
        return _not_found()
    return ApiError(409, ErrorCode.not_ready, "Recording is not ready.")


def _clean_title(title: str | None) -> str | None:
    if title is None:
        return None
    trimmed = title.strip()
    if not trimmed:
        raise ApiError(422, ErrorCode.validation_error, "The title cannot be empty.")
    return trimmed


def _clean_tags(tags: list[str] | None) -> list[str] | None:
    if tags is None:
        return None
    normalized = [normalize_tag(tag) for tag in tags]
    if any(not name for name in normalized):
        raise ApiError(422, ErrorCode.validation_error, "A tag cannot be empty.")
    return normalized


def _replace_tags(conn: sqlite3.Connection, rec_id: str, names: list[str]) -> None:
    existing = {row["name"]: row["id"] for row in conn.execute("SELECT id, name FROM tags")}
    tag_ids: list[str] = []
    for name in names:
        reused = match_existing_tag(name, existing.keys())
        if reused is None:
            tag_id = new_id("tag")
            conn.execute("INSERT INTO tags (id, name) VALUES (?, ?)", (tag_id, name))
            existing[name] = tag_id
        else:
            tag_id = existing[reused]
        if tag_id not in tag_ids:
            tag_ids.append(tag_id)
    conn.execute("DELETE FROM recording_tags WHERE recording_id = ?", (rec_id,))
    conn.executemany(
        "INSERT INTO recording_tags (recording_id, tag_id) VALUES (?, ?)", [(rec_id, tag_id) for tag_id in tag_ids]
    )


def update_recording(conn: sqlite3.Connection, rec_id: str, patch: RecordingPatchIn) -> RecordingOut:
    title = _clean_title(patch.title)
    tags = _clean_tags(patch.tags)
    with conn:
        # The guarded update opens the write transaction, so the ready check and the changes are one unit.
        updated = conn.execute(
            "UPDATE recordings SET title = COALESCE(?, title) WHERE id = ? AND status = 'ready'", (title, rec_id)
        ).rowcount
        if updated == 0:
            raise _not_ready_or_missing(conn, rec_id)
        if tags is not None:
            _replace_tags(conn, rec_id, tags)
    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    if row is None:
        raise _not_found()
    return recording_out(conn, row)


def rename_speaker(conn: sqlite3.Connection, rec_id: str, speaker_id: str, patch: SpeakerPatchIn) -> SpeakerOut:
    name = patch.name.strip() or None
    with conn:
        row = conn.execute(
            "UPDATE speakers SET name = ? WHERE id = ? AND recording_id = ? "
            "AND EXISTS (SELECT 1 FROM recordings WHERE id = ? AND status = 'ready') RETURNING id, label, name",
            (name, speaker_id, rec_id, rec_id),
        ).fetchone()
    if row is None:
        status = _status(conn, rec_id)
        if status is None:
            raise _not_found()
        if status != "ready":
            raise ApiError(409, ErrorCode.not_ready, "Recording is not ready.")
        raise ApiError(404, ErrorCode.not_found, "Speaker not found.")
    return SpeakerOut(
        id=row["id"], label=row["label"], name=row["name"], display_name=display_name(row["label"], row["name"])
    )


def delete_recording(conn: sqlite3.Connection, data_dir: Path, rec_id: str) -> None:
    with conn:
        # One statement: SQLite serialises it with the worker's claim, so a claimed recording is never touched.
        deleted = conn.execute(
            "DELETE FROM recordings WHERE id = ? AND claimed = 0 RETURNING id, audio_ext", (rec_id,)
        ).fetchall()
    if not deleted:
        if _status(conn, rec_id) is None:
            raise _not_found()
        raise ApiError(409, ErrorCode.recording_busy, "Recording is being processed.")
    # Files go only once the rows are committed, so a failure here never leaves rows without their audio.
    # The paths come from the deleted row, never from the request.
    remove_recording_files(data_dir, deleted[0]["id"], deleted[0]["audio_ext"])


def retry_recording(conn: sqlite3.Connection, rec_id: str) -> RecordingOut:
    with conn:
        updated = conn.execute(_RETRY_SQL, (rec_id,)).rowcount
    if updated == 0:
        if _status(conn, rec_id) is None:
            raise _not_found()
        raise ApiError(409, ErrorCode.not_failed, "Recording cannot be retried.")
    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    if row is None:
        raise _not_found()
    return recording_out(conn, row)
