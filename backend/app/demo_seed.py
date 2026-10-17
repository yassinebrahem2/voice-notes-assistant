"""Seed realistic demo recordings for mobile development."""

import json
import sqlite3

from ulid import ULID

from app.container import Container
from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.domain.analysis import (
    AnalysisActionItem,
    AnalysisItem,
    Citation,
    MeetingSummary,
    NoteContent,
)
from app.domain.tags import normalize_tag
from app.ids import new_id
from app.rag.vectors import pack_embedding


class DemoSeedError(RuntimeError):
    """Raised when demo seeding cannot proceed."""


def _insert_tags(conn: sqlite3.Connection, rec_id: str, tags: list[str]) -> None:
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


def _seed_demo_meeting(conn: sqlite3.Connection, container: Container) -> str:
    meeting_id = new_id("rec")
    spk_a_id = new_id("spk")
    spk_b_id = new_id("spk")

    segment_data: list[tuple[int, int, str, str]] = [
        (0, 7500, spk_a_id, "Good morning Alex. Let's do a quick sync on the project status."),
        (8000, 16500, spk_b_id, "Morning Sarah. The mobile shell and tab navigation are in place."),
        (17000, 26000, spk_a_id, "Great. Did we decide on the database schema for chunks and vectors?"),
        (26500, 37000, spk_b_id, "Yes, we agreed to store sqlite-vec embeddings as little-endian float32 blobs."),
        (37500, 47000, spk_a_id, "Perfect, let's make that official. Who will handle the indexing pipeline?"),
        (47500, 58000, spk_b_id, "I can take the indexing pipeline and deliver it by next Friday."),
        (58500, 69000, spk_a_id, "Thanks. Do we also need to benchmark search latencies on older Android phones?"),
        (69500, 80000, spk_b_id, "We should test that once the real ASR and embedding models are wired in."),
    ]
    seg_ids = [new_id("seg") for _ in range(len(segment_data))]

    summary = MeetingSummary(
        overview=f"Discussion between {{{{{spk_a_id}}}}} and {{{{{spk_b_id}}}}} regarding schema and indexing.",
        decisions=[
            AnalysisItem(
                text="Store sqlite-vec embeddings as little-endian float32 blobs.",
                citations=[Citation(recording_id=meeting_id, segment_id=seg_ids[3], start_ms=26500)],
            )
        ],
        action_items=[
            AnalysisActionItem(
                text=f"{{{{{spk_b_id}}}}} will implement the indexing pipeline.",
                citations=[Citation(recording_id=meeting_id, segment_id=seg_ids[5], start_ms=47500)],
                owner_speaker_id=spk_b_id,
                due="2026-10-24",
            )
        ],
        open_questions=[
            AnalysisItem(
                text="Do we need to benchmark search latencies on older Android phones?",
                citations=[Citation(recording_id=meeting_id, segment_id=seg_ids[6], start_ms=58500)],
            )
        ],
    )

    peaks = [round(0.1 + 0.8 * abs((i % 10 - 5) / 5.0), 3) for i in range(50)]
    conn.execute(
        """INSERT INTO recordings (
            id, kind, client_upload_id, status, claimed, title, created_at,
            duration_ms, audio_ext, waveform_peaks, analysis
        ) VALUES (
            ?, 'meeting', ?, 'ready', 0, 'Weekly Project Standup',
            '2026-10-17T09:00:00Z', 80000, 'm4a', ?, ?
        )""",
        (meeting_id, f"demo_meeting_{ULID()}", json.dumps(peaks), summary.model_dump_json()),
    )

    conn.execute(
        "INSERT INTO speakers (id, recording_id, label, name) VALUES (?, ?, 'A', 'Sarah')",
        (spk_a_id, meeting_id),
    )
    conn.execute(
        "INSERT INTO speakers (id, recording_id, label, name) VALUES (?, ?, 'B', 'Alex')",
        (spk_b_id, meeting_id),
    )

    for idx, (start_ms, end_ms, spk_id, text) in enumerate(segment_data):
        conn.execute(
            """INSERT INTO segments (id, recording_id, idx, start_ms, end_ms, speaker_id, text)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (seg_ids[idx], meeting_id, idx, start_ms, end_ms, spk_id, text),
        )

    _insert_tags(conn, meeting_id, ["standup", "planning"])

    # Chunks
    chunk1_text = " ".join(s[3] for s in segment_data[0:4])
    chunk2_text = " ".join(s[3] for s in segment_data[4:8])
    vectors = container.embedder.embed_passages([chunk1_text, chunk2_text])

    for chk_text, first_idx, last_idx, start_ms, end_ms, vec in [
        (chunk1_text, 0, 3, 0, 37000, vectors[0]),
        (chunk2_text, 4, 7, 37500, 80000, vectors[1]),
    ]:
        conn.execute(
            """INSERT INTO chunks
            (id, recording_id, first_segment_id, last_segment_id, start_ms, end_ms, text, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_id("chk"),
                meeting_id,
                seg_ids[first_idx],
                seg_ids[last_idx],
                start_ms,
                end_ms,
                chk_text,
                pack_embedding(vec),
            ),
        )

    return meeting_id


def _seed_demo_note(conn: sqlite3.Connection, container: Container) -> str:
    note_id = new_id("rec")

    note_segments: list[tuple[int, int, str]] = [
        (0, 14000, "We should keep all vector indexes in SQLite using sqlite-vec for simplicity."),
        (14500, 29000, "Chunk boundaries should break at speaker turns when possible or at token limits."),
        (29500, 45000, "Cosine distance with normalized embeddings gives the best recall across short queries."),
    ]
    seg_ids = [new_id("seg") for _ in range(len(note_segments))]

    note_content = NoteContent(
        key_points=[
            AnalysisItem(
                text="Keep all vector indexes in SQLite using sqlite-vec.",
                citations=[Citation(recording_id=note_id, segment_id=seg_ids[0], start_ms=0)],
            ),
            AnalysisItem(
                text="Break chunk boundaries at speaker turns or token limits.",
                citations=[Citation(recording_id=note_id, segment_id=seg_ids[1], start_ms=14500)],
            ),
            AnalysisItem(
                text="Use cosine distance with normalized embeddings for retrieval.",
                citations=[Citation(recording_id=note_id, segment_id=seg_ids[2], start_ms=29500)],
            ),
        ],
        clean_text=(
            "# Architecture Ideas for Offline Search\n\n"
            "- Store vector indexes in SQLite using sqlite-vec.\n"
            "- Chunk boundaries align with speaker turns or token limits.\n"
            "- Cosine distance provides robust short-query recall."
        ),
    )

    peaks = [round(0.1 + 0.6 * ((i % 8) / 8.0), 3) for i in range(40)]
    conn.execute(
        """INSERT INTO recordings (
            id, kind, client_upload_id, status, claimed, title, created_at,
            duration_ms, audio_ext, waveform_peaks, analysis
        ) VALUES (
            ?, 'note', ?, 'ready', 0, 'Architecture Ideas for Offline Search',
            '2026-10-17T11:00:00Z', 45000, 'm4a', ?, ?
        )""",
        (note_id, f"demo_note_{ULID()}", json.dumps(peaks), note_content.model_dump_json()),
    )

    for idx, (start_ms, end_ms, text) in enumerate(note_segments):
        conn.execute(
            """INSERT INTO segments (id, recording_id, idx, start_ms, end_ms, speaker_id, text)
            VALUES (?, ?, ?, ?, ?, NULL, ?)""",
            (seg_ids[idx], note_id, idx, start_ms, end_ms, text),
        )

    _insert_tags(conn, note_id, ["architecture", "search"])

    chunk_text = " ".join(s[2] for s in note_segments)
    vectors = container.embedder.embed_passages([chunk_text])
    conn.execute(
        """INSERT INTO chunks
        (id, recording_id, first_segment_id, last_segment_id, start_ms, end_ms, text, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            new_id("chk"),
            note_id,
            seg_ids[0],
            seg_ids[-1],
            0,
            45000,
            chunk_text,
            pack_embedding(vectors[0]),
        ),
    )

    return note_id


def seed_demo(container: Container) -> tuple[str, str]:
    """Seed a ready meeting and a ready note into the database."""
    container.settings.data_dir.mkdir(parents=True, exist_ok=True)
    conn = connect(container.db_path)
    try:
        apply_migrations(conn)
        row = conn.execute("SELECT COUNT(*) FROM recordings").fetchone()
        existing = row[0] if row is not None else 0
        if existing > 0:
            raise DemoSeedError("Recordings already exist in data directory. Demo seed refused.")

        meeting_id = _seed_demo_meeting(conn, container)
        note_id = _seed_demo_note(conn, container)
        conn.commit()
        return meeting_id, note_id
    finally:
        conn.close()
