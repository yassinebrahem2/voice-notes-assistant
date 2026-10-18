"""Read-side queries behind the library, detail and tags endpoints."""

import json
import sqlite3
from datetime import datetime

from app.api.errors import ApiError, ErrorCode
from app.api.models.recordings import RecordingDetailOut, RecordingOut, SegmentOut, SpeakerOut
from app.api.models.tags import TagOut
from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.analysis_render import render_analysis
from app.domain.speakers import display_name
from app.domain.types import RecordingKind

_LIKE_ESCAPE = "\\"

# Counts are per tag across all recordings, so one definition serves the tag list and the chips on a recording.
_TAGS_WITH_COUNT = (
    "SELECT t.id, t.name, (SELECT COUNT(*) FROM recording_tags rt WHERE rt.tag_id = t.id) AS count FROM tags t"
)
_RECORDING_TAGS_SQL = (
    _TAGS_WITH_COUNT + " JOIN recording_tags own ON own.tag_id = t.id WHERE own.recording_id = ? ORDER BY t.name"
)
_ALL_TAGS_SQL = _TAGS_WITH_COUNT + " ORDER BY t.name"

# One fixed statement with optional filters keeps every user value a bound parameter.
_LIST_SQL = """
SELECT r.* FROM recordings r
WHERE (:kind IS NULL OR r.kind = :kind)
  AND (:pattern IS NULL
       OR r.title LIKE :pattern ESCAPE '\\'
       OR EXISTS (SELECT 1 FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id
                  WHERE rt.recording_id = r.id AND t.name LIKE :pattern ESCAPE '\\')
       OR EXISTS (SELECT 1 FROM segments s
                  WHERE s.recording_id = r.id AND s.text LIKE :pattern ESCAPE '\\'))
  AND (SELECT COUNT(DISTINCT rt.tag_id) FROM recording_tags rt
       WHERE rt.recording_id = r.id AND rt.tag_id IN (SELECT value FROM json_each(:tag_ids))) = :tag_count
ORDER BY r.created_at DESC, r.id DESC
"""


def _tag_out(row: sqlite3.Row) -> TagOut:
    return TagOut(id=row["id"], name=row["name"], count=row["count"])


def _escape_like(text: str) -> str:
    return (
        text.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2).replace("%", _LIKE_ESCAPE + "%").replace("_", _LIKE_ESCAPE + "_")
    )


def recording_out(conn: sqlite3.Connection, row: sqlite3.Row) -> RecordingOut:
    tag_rows = conn.execute(_RECORDING_TAGS_SQL, (row["id"],)).fetchall()
    peaks: str | None = row["waveform_peaks"]
    error_code: str | None = row["error_code"]
    return RecordingOut(
        id=row["id"],
        kind=row["kind"],
        title=row["title"],
        status=row["status"],
        failed_step=row["failed_step"],
        error_code=ErrorCode(error_code) if error_code is not None else None,
        error_message=row["error_message"],
        created_at=datetime.fromisoformat(row["created_at"]),
        duration_ms=row["duration_ms"],
        tags=[_tag_out(tag_row) for tag_row in tag_rows],
        waveform_peaks=[float(peak) for peak in json.loads(peaks)] if peaks is not None else None,
        processing=bool(row["claimed"]),
    )


def list_recordings(
    conn: sqlite3.Connection, kind: RecordingKind | None, q: str | None, tag_ids: list[str]
) -> list[RecordingOut]:
    wanted = sorted(set(tag_ids))
    params = {
        "kind": kind,
        "pattern": f"%{_escape_like(q)}%" if q else None,
        "tag_ids": json.dumps(wanted),
        "tag_count": len(wanted),
    }
    rows = conn.execute(_LIST_SQL, params).fetchall()
    return [recording_out(conn, row) for row in rows]


def get_recording_detail(conn: sqlite3.Connection, rec_id: str) -> RecordingDetailOut:
    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    if row is None:
        raise ApiError(404, ErrorCode.not_found, "Recording not found.")
    speakers = [
        SpeakerOut(id=s["id"], label=s["label"], name=s["name"], display_name=display_name(s["label"], s["name"]))
        for s in conn.execute("SELECT * FROM speakers WHERE recording_id = ? ORDER BY label", (rec_id,))
    ]
    segments = [
        SegmentOut(
            id=s["id"],
            idx=s["idx"],
            start_ms=s["start_ms"],
            end_ms=s["end_ms"],
            speaker_id=s["speaker_id"],
            text=s["text"],
        )
        for s in conn.execute("SELECT * FROM segments WHERE recording_id = ? ORDER BY idx", (rec_id,))
    ]
    names = {speaker.id: speaker.display_name for speaker in speakers}
    stored: str | None = row["analysis"]
    summary: MeetingSummary | None = None
    note: NoteContent | None = None
    if stored is not None:
        if row["kind"] == "meeting":
            summary = render_analysis(MeetingSummary.model_validate_json(stored), names)
        else:
            note = render_analysis(NoteContent.model_validate_json(stored), names)
    return RecordingDetailOut(
        **dict(recording_out(conn, row)), speakers=speakers, segments=segments, summary=summary, note=note
    )


def list_tags(conn: sqlite3.Connection) -> list[TagOut]:
    return [_tag_out(row) for row in conn.execute(_ALL_TAGS_SQL)]
