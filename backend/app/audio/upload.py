"""Saving an uploaded recording: the whole file first, then its row, so a failed upload leaves neither."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from fastapi import UploadFile

from app.api.errors import ApiError, ErrorCode
from app.api.models.recordings import RecordingOut
from app.audio.storage import audio_path
from app.domain.types import RecordingKind
from app.ids import new_id
from app.recordings.read import recording_out

ALLOWED_EXTENSIONS = {"m4a", "mp4", "aac", "wav", "mp3"}

_CHUNK_BYTES = 1024 * 1024

_INSERT_SQL = """
INSERT INTO recordings (id, kind, client_upload_id, status, claimed, created_at, audio_ext)
VALUES (?, ?, ?, 'uploaded', 0, ?, ?)
RETURNING *
"""


def _extension(filename: str | None) -> str:
    # Only the allow-listed suffix is kept: the rest of the user's file name never reaches a path.
    _, dot, suffix = (filename or "").rpartition(".")
    ext = suffix.lower()
    if not dot or ext not in ALLOWED_EXTENSIONS:
        raise ApiError(415, ErrorCode.unsupported_media_type, "This audio format is not supported.")
    return ext


def _existing(conn: sqlite3.Connection, client_upload_id: str) -> RecordingOut | None:
    row = conn.execute("SELECT * FROM recordings WHERE client_upload_id = ?", (client_upload_id,)).fetchone()
    return recording_out(conn, row) if row is not None else None


def _copy_limited(source: BinaryIO, dest: Path, max_bytes: int) -> None:
    written = 0
    with dest.open("xb") as out:
        while chunk := source.read(_CHUNK_BYTES):
            written += len(chunk)
            if written > max_bytes:
                raise ApiError(413, ErrorCode.payload_too_large, "The file is too large.")
            out.write(chunk)


def _discard(*paths: Path | None) -> None:
    for path in paths:
        if path is not None:
            path.unlink(missing_ok=True)


def store_upload(
    conn: sqlite3.Connection,
    data_dir: Path,
    *,
    kind: RecordingKind,
    client_upload_id: str,
    file: UploadFile,
    max_bytes: int,
) -> tuple[RecordingOut, bool]:
    ext = _extension(file.filename)
    # A retry after a dropped response must not store the audio a second time.
    existing = _existing(conn, client_upload_id)
    if existing is not None:
        return existing, False
    rec_id = new_id("rec")
    temp = data_dir / "tmp" / f"upload-{uuid4().hex}"
    # Set only once the move has happened: os.replace is atomic, so exactly one of the two paths holds the file.
    moved: Path | None = None
    try:
        temp.parent.mkdir(parents=True, exist_ok=True)
        _copy_limited(file.file, temp, max_bytes)
        final = audio_path(data_dir, rec_id, ext)
        final.parent.mkdir(parents=True, exist_ok=True)
        temp.replace(final)
        moved = final
        created_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        with conn:
            row = conn.execute(_INSERT_SQL, (rec_id, kind, client_upload_id, created_at, ext)).fetchone()
    except sqlite3.IntegrityError:
        _discard(temp, moved)
        # The same upload arriving twice at once: the request that inserted first keeps its file and row.
        existing = _existing(conn, client_upload_id)
        if existing is None:
            raise
        return existing, False
    except BaseException:
        _discard(temp, moved)
        raise
    return recording_out(conn, row), True
