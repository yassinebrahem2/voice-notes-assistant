"""Builds a recording's search index: its chunks and their embeddings."""

import sqlite3

from app.config.settings import Settings
from app.domain.types import RecordingKind
from app.ids import new_id
from app.rag.chunker import chunk_segments, load_segment_rows
from app.rag.protocols import Embedder
from app.rag.vectors import pack_embedding

_CHUNK_INSERT_SQL = """
INSERT INTO chunks (id, recording_id, first_segment_id, last_segment_id, start_ms, end_ms, text, embedding)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
"""


def index_recording(conn: sqlite3.Connection, embedder: Embedder, rec_id: str, settings: Settings) -> int:
    """Replaces the recording's chunks, marks it ready and returns how many chunks it now has."""
    kind: RecordingKind = conn.execute("SELECT kind FROM recordings WHERE id = ?", (rec_id,)).fetchone()["kind"]
    segments = load_segment_rows(conn, rec_id)
    drafts = chunk_segments(segments, kind, settings.chunk_max_tokens, settings.chunk_min_tokens_at_speaker_change)
    # Embedding is slow, so it runs before the write transaction opens.
    vectors = embedder.embed_passages([draft.text for draft in drafts])
    segment_ids = {segment.idx: segment.id for segment in segments}
    rows = [
        (
            new_id("chk"),
            rec_id,
            segment_ids[draft.first_idx],
            segment_ids[draft.last_idx],
            draft.start_ms,
            draft.end_ms,
            draft.text,
            pack_embedding(vector),
        )
        for draft, vector in zip(drafts, vectors, strict=True)
    ]
    with conn:
        conn.execute("DELETE FROM chunks WHERE recording_id = ?", (rec_id,))
        conn.executemany(_CHUNK_INSERT_SQL, rows)
        conn.execute("UPDATE recordings SET status = 'ready', claimed = 0 WHERE id = ?", (rec_id,))
    return len(rows)
