"""Seed helpers for tests across backend modules."""

import sqlite3
from collections.abc import Sequence

from ulid import ULID

from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.tags import normalize_tag
from app.domain.types import RecordingKind, RecordingStatus
from app.ids import new_id
from app.rag.vectors import pack_embedding

DEFAULT_SEGMENTS: tuple[tuple[int, int, str | None, str], ...] = (
    (0, 3000, "A", "Hi everyone, let's start the budget sync."),
    (3200, 6500, "B", "Sounds good, I have the numbers ready."),
)


def seed_recording(
    conn: sqlite3.Connection,
    *,
    kind: RecordingKind = "meeting",
    status: RecordingStatus = "ready",
    title: str | None = "Budget sync",
    segments: Sequence[tuple[int, int, str | None, str]] = DEFAULT_SEGMENTS,
    tags: Sequence[str] = (),
    analysis: MeetingSummary | NoteContent | None = None,
    created_at: str | None = None,
    claimed: bool = False,
) -> str:
    """Insert a recording with speakers, segments, tags, and optional analysis."""
    rec_id = new_id("rec")
    client_upload_id = f"upload_{ULID()}"
    ts = created_at or "2026-10-17T00:00:00Z"
    duration_ms = max((s[1] for s in segments), default=0)
    analysis_json = analysis.model_dump_json() if analysis is not None else None

    conn.execute(
        """INSERT INTO recordings (
            id, kind, client_upload_id, status, claimed, title, created_at, duration_ms, audio_ext, analysis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'm4a', ?)""",
        (
            rec_id,
            kind,
            client_upload_id,
            status,
            1 if claimed else 0,
            title,
            ts,
            duration_ms,
            analysis_json,
        ),
    )

    label_to_id: dict[str, str] = {}
    for _, _, label, _ in segments:
        if label is not None and label not in label_to_id:
            spk_id = new_id("spk")
            conn.execute(
                "INSERT INTO speakers (id, recording_id, label) VALUES (?, ?, ?)",
                (spk_id, rec_id, label),
            )
            label_to_id[label] = spk_id

    for idx, (start_ms, end_ms, label, text) in enumerate(segments):
        seg_id = new_id("seg")
        spk_id = label_to_id.get(label) if label is not None else None
        conn.execute(
            """INSERT INTO segments (id, recording_id, idx, start_ms, end_ms, speaker_id, text)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (seg_id, rec_id, idx, start_ms, end_ms, spk_id, text),
        )

    for tag_name in tags:
        norm = normalize_tag(tag_name)
        row = conn.execute("SELECT id FROM tags WHERE name = ?", (norm,)).fetchone()
        if row is not None:
            tag_id: str = row["id"] if isinstance(row, sqlite3.Row) else str(row[0])
        else:
            tag_id = new_id("tag")
            conn.execute("INSERT INTO tags (id, name) VALUES (?, ?)", (tag_id, norm))
        conn.execute(
            "INSERT OR IGNORE INTO recording_tags (recording_id, tag_id) VALUES (?, ?)",
            (rec_id, tag_id),
        )

    conn.commit()
    return rec_id


def seed_chunk(
    conn: sqlite3.Connection,
    rec_id: str,
    *,
    first_idx: int,
    last_idx: int,
    text: str,
    vector: Sequence[float],
) -> str:
    """Insert a chunk spanning segments with packed float32 embedding."""
    first_seg = conn.execute(
        "SELECT id, start_ms FROM segments WHERE recording_id = ? AND idx = ?",
        (rec_id, first_idx),
    ).fetchone()
    last_seg = conn.execute(
        "SELECT id, end_ms FROM segments WHERE recording_id = ? AND idx = ?",
        (rec_id, last_idx),
    ).fetchone()
    if not first_seg or not last_seg:
        raise ValueError(f"Could not find segments with idx {first_idx} and {last_idx} for recording {rec_id}")

    chk_id = new_id("chk")
    first_seg_id: str = first_seg["id"] if isinstance(first_seg, sqlite3.Row) else str(first_seg[0])
    last_seg_id: str = last_seg["id"] if isinstance(last_seg, sqlite3.Row) else str(last_seg[0])
    start_ms: int = first_seg["start_ms"] if isinstance(first_seg, sqlite3.Row) else int(first_seg[1])
    end_ms: int = last_seg["end_ms"] if isinstance(last_seg, sqlite3.Row) else int(last_seg[1])

    conn.execute(
        """INSERT INTO chunks
        (id, recording_id, first_segment_id, last_segment_id, start_ms, end_ms, text, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            chk_id,
            rec_id,
            first_seg_id,
            last_seg_id,
            start_ms,
            end_ms,
            text,
            pack_embedding(vector),
        ),
    )
    conn.commit()
    return chk_id
