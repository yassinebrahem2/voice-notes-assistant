"""The processing steps that take one claimed recording from its current status to ready or failed.

Every step does its slow work (decode, ASR, diarization) with no transaction open, then commits its output and
its status move in one short `with conn:` block, so the API is never blocked behind the worker and a step's old
output is replaced together with its new output or not at all.
"""

import json
import logging
import sqlite3
from pathlib import Path
from typing import Literal

from app.api.errors import ErrorCode, describe_frames
from app.audio.decode import decode_to_npy
from app.audio.storage import audio_path, tmp_dir
from app.container import Container
from app.domain.analysis import MeetingSummary, NoteContent
from app.ids import new_id
from app.processing.speakers import assign_speakers
from app.speech.protocols import AsrSegment

logger = logging.getLogger(__name__)

Step = Literal["decoding", "transcribing", "diarizing", "analyzing", "indexing"]

UNTITLED = "Untitled recording"

# Shown to the user, so they never carry exception text: that can hold paths, URLs or keys.
_FAILURES: dict[Step, tuple[ErrorCode, str]] = {
    "decoding": (ErrorCode.audio_unreadable, "The audio could not be read."),
    "transcribing": (ErrorCode.transcription_failed, "The recording could not be transcribed."),
    "diarizing": (ErrorCode.diarization_failed, "The speakers could not be identified."),
    "analyzing": (ErrorCode.analysis_failed, "The recording could not be analyzed."),
    "indexing": (ErrorCode.indexing_failed, "The recording could not be indexed for search."),
}

_FAIL_SQL = """
UPDATE recordings
SET status = 'failed', failed_step = ?, error_code = ?, error_message = ?, claimed = 0
WHERE id = ?
"""

_DECODED_SQL = """
UPDATE recordings SET duration_ms = COALESCE(duration_ms, ?), waveform_peaks = COALESCE(waveform_peaks, ?) WHERE id = ?
"""

_SEGMENT_INSERT_SQL = """
INSERT INTO segments (id, recording_id, idx, start_ms, end_ms, speaker_id, text) VALUES (?, ?, ?, ?, ?, NULL, ?)
"""


class StepError(Exception):
    """A step failure with a code and a message fit to show the user."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _audio_npy(container: Container, rec_id: str) -> Path:
    return tmp_dir(container.settings.data_dir, rec_id) / "audio.npy"


def _remove_tmp(container: Container, rec_id: str) -> None:
    tmp = tmp_dir(container.settings.data_dir, rec_id)
    if tmp.is_symlink():
        # Removing the link itself keeps whatever it points at untouched.
        tmp.unlink()
        return
    # Only the decoded audio is ever written here, so nothing wider than that file is removed.
    (tmp / "audio.npy").unlink(missing_ok=True)
    if tmp.is_dir():
        tmp.rmdir()


def _start_decoding(conn: sqlite3.Connection, rec_id: str) -> None:
    with conn:
        conn.execute("UPDATE recordings SET status = 'transcribing' WHERE id = ?", (rec_id,))


def _ensure_audio(container: Container, conn: sqlite3.Connection, row: sqlite3.Row) -> Path:
    """Decodes the upload unless a complete earlier decode is still on disk (it is gone after a restart)."""
    npy = _audio_npy(container, row["id"])
    # NULL peaks mean the server stopped before the first decode was stored, so its file cannot be trusted.
    if npy.is_file() and row["waveform_peaks"] is not None and row["duration_ms"] is not None:
        return npy
    decoded = decode_to_npy(audio_path(container.settings.data_dir, row["id"], row["audio_ext"]), npy)
    with conn:
        # Values already stored are kept: a re-decode after a restart must not change what the app has shown.
        conn.execute(_DECODED_SQL, (decoded.duration_ms, json.dumps(decoded.peaks), row["id"]))
    return npy


def _store_untitled(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    # A fixed empty result instead of null, so the app shows its empty state; no model ever sees silence.
    empty = (
        MeetingSummary(overview="", decisions=[], action_items=[], open_questions=[])
        if row["kind"] == "meeting"
        else NoteContent(key_points=[], clean_text="")
    )
    conn.execute("DELETE FROM segments WHERE recording_id = ?", (row["id"],))
    conn.execute("DELETE FROM recording_tags WHERE recording_id = ?", (row["id"],))
    conn.execute(
        "UPDATE recordings SET title = ?, analysis = ?, status = 'ready', claimed = 0 WHERE id = ?",
        (UNTITLED, empty.model_dump_json(), row["id"]),
    )


def _transcribe(container: Container, conn: sqlite3.Connection, row: sqlite3.Row, npy: Path) -> None:
    rec_id: str = row["id"]
    segments = container.asr.transcribe(npy)
    with conn:
        if not segments:
            _store_untitled(conn, row)
            return
        # Chunks cascade with the segments they cite, so nothing is left pointing at the old transcript.
        conn.execute("DELETE FROM segments WHERE recording_id = ?", (rec_id,))
        conn.executemany(
            _SEGMENT_INSERT_SQL,
            [
                (new_id("seg"), rec_id, idx, segment.start_ms, segment.end_ms, segment.text)
                for idx, segment in enumerate(segments)
            ],
        )
        next_status = "diarizing" if row["kind"] == "meeting" else "analyzing"
        conn.execute("UPDATE recordings SET status = ? WHERE id = ?", (next_status, rec_id))


def _diarize(container: Container, conn: sqlite3.Connection, rec_id: str, npy: Path) -> None:
    turns = container.diarizer.diarize(npy)
    rows = conn.execute(
        "SELECT id, start_ms, end_ms, text FROM segments WHERE recording_id = ? ORDER BY idx", (rec_id,)
    ).fetchall()
    labels = assign_speakers([AsrSegment(row["start_ms"], row["end_ms"], row["text"]) for row in rows], turns)
    speaker_ids = {label: new_id("spk") for label in dict.fromkeys(labels)}
    with conn:
        # Deleting the old speakers also clears segments.speaker_id (ON DELETE SET NULL) before it is set again.
        conn.execute("DELETE FROM speakers WHERE recording_id = ?", (rec_id,))
        conn.executemany(
            "INSERT INTO speakers (id, recording_id, label) VALUES (?, ?, ?)",
            [(speaker_id, rec_id, label) for label, speaker_id in speaker_ids.items()],
        )
        conn.executemany(
            "UPDATE segments SET speaker_id = ? WHERE id = ?",
            [(speaker_ids[label], row["id"]) for row, label in zip(rows, labels, strict=True)],
        )
        conn.execute("UPDATE recordings SET status = 'analyzing' WHERE id = ?", (rec_id,))


def _analyze(conn: sqlite3.Connection, rec_id: str) -> None:
    """Only moves the status on: storing the analyzer's output is the next plan task, which replaces this body."""
    with conn:
        conn.execute("UPDATE recordings SET status = 'indexing' WHERE id = ?", (rec_id,))


def _index(conn: sqlite3.Connection, rec_id: str) -> None:
    """Only marks the recording ready: chunking and embedding are the next plan task, which replaces this body."""
    with conn:
        conn.execute("UPDATE recordings SET status = 'ready', claimed = 0 WHERE id = ?", (rec_id,))


def _fail(conn: sqlite3.Connection, rec_id: str, step: Step, error: Exception) -> None:
    # Type and frame locations only: the message of a provider or child-process error can carry a URL or a key.
    logger.error(
        "Processing step %s failed for recording %s: %s at %s",
        step,
        rec_id,
        type(error).__name__,
        describe_frames(error),
    )
    code, message = (error.code, error.message) if isinstance(error, StepError) else _FAILURES[step]
    with conn:
        conn.execute(_FAIL_SQL, (step, code.value, message, rec_id))


def _run_steps(container: Container, conn: sqlite3.Connection, rec_id: str) -> None:
    """Runs one step after another, from the stored status, until the recording is ready or a step fails."""
    # Which step was running when an error came, for the failure record; a decode on demand counts as decoding.
    step: Step = "decoding"
    try:
        while True:
            row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
            if row is None or row["status"] in ("ready", "failed"):
                return
            status: str = row["status"]
            step = "decoding"
            if status == "uploaded":
                _start_decoding(conn, rec_id)
                continue
            if status == "transcribing":
                npy = _ensure_audio(container, conn, row)
                step = "transcribing"
                _transcribe(container, conn, row, npy)
            elif status == "diarizing":
                npy = _ensure_audio(container, conn, row)
                step = "diarizing"
                _diarize(container, conn, rec_id, npy)
            elif status == "analyzing":
                step = "analyzing"
                _analyze(conn, rec_id)
            else:
                # The schema allows no other status, so this is indexing.
                step = "indexing"
                _index(conn, rec_id)
    except Exception as error:
        _fail(conn, rec_id, step, error)


def process_recording(container: Container, conn: sqlite3.Connection, rec_id: str) -> None:
    """Takes a claimed recording from its current status to ready, or records which step failed and why."""
    _run_steps(container, conn, rec_id)
    _remove_tmp(container, rec_id)
