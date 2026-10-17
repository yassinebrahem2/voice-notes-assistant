"""Exact chunk retrieval over sqlite-vec embeddings filtered by scope and tags."""

import json
import sqlite3
from dataclasses import dataclass
from typing import Literal, cast

from app.domain.types import RecordingKind
from app.rag.protocols import Embedder
from app.rag.vectors import pack_embedding

SEARCH_CHUNKS_SQL = """
SELECT
    c.recording_id,
    COALESCE(r.title, '') AS recording_title,
    r.kind,
    r.created_at,
    c.first_segment_id,
    c.start_ms,
    c.end_ms,
    c.text,
    vec_distance_cosine(c.embedding, :query_blob) AS distance
FROM chunks c
JOIN recordings r ON r.id = c.recording_id
WHERE r.status = 'ready'
  AND (:kind_filter IS NULL OR r.kind = :kind_filter)
  AND (
    :require_tags_count = 0
    OR r.id IN (
        SELECT recording_id
        FROM recording_tags
        WHERE tag_id IN (SELECT value FROM json_each(:tag_ids_json))
        GROUP BY recording_id
        HAVING COUNT(DISTINCT tag_id) = :require_tags_count
    )
  )
ORDER BY distance ASC
LIMIT :limit
"""


@dataclass
class Hit:
    recording_id: str
    recording_title: str
    kind: RecordingKind
    created_at: str
    first_segment_id: str
    start_ms: int
    end_ms: int
    text: str
    distance: float


def search_chunks(
    conn: sqlite3.Connection,
    embedder: Embedder,
    query: str,
    *,
    scope: Literal["notes", "meetings", "both"],
    tag_ids: list[str],
    k: int,
    max_distance: float,
) -> list[Hit]:
    """Retrieve top-k chunks within max_distance, merging adjacent hits per recording."""
    if k <= 0:
        return []

    kind_filter: str | None
    if scope == "notes":
        kind_filter = "note"
    elif scope == "meetings":
        kind_filter = "meeting"
    elif scope == "both":
        kind_filter = None
    else:
        raise ValueError(f"Unknown scope: {scope}")

    unique_tags = list(dict.fromkeys(tag_ids))
    query_blob = pack_embedding(embedder.embed_query(query))

    rows = conn.execute(
        SEARCH_CHUNKS_SQL,
        {
            "query_blob": query_blob,
            "kind_filter": kind_filter,
            "require_tags_count": len(unique_tags),
            "tag_ids_json": json.dumps(unique_tags),
            "limit": k,
        },
    ).fetchall()

    raw_hits: list[Hit] = []
    for row in rows:
        distance = float(row["distance"])
        if distance > max_distance:
            continue
        raw_hits.append(
            Hit(
                recording_id=str(row["recording_id"]),
                recording_title=str(row["recording_title"]),
                kind=cast(RecordingKind, row["kind"]),
                created_at=str(row["created_at"]),
                first_segment_id=str(row["first_segment_id"]),
                start_ms=int(row["start_ms"]),
                end_ms=int(row["end_ms"]),
                text=str(row["text"]),
                distance=distance,
            )
        )

    if not raw_hits:
        return []

    by_recording: dict[str, list[Hit]] = {}
    for hit in raw_hits:
        by_recording.setdefault(hit.recording_id, []).append(hit)

    merged_hits: list[Hit] = []
    for rec_hits in by_recording.values():
        rec_hits.sort(key=lambda h: (h.start_ms, h.end_ms))
        current = rec_hits[0]
        for nxt in rec_hits[1:]:
            if nxt.start_ms <= current.end_ms:
                earliest_seg_id = current.first_segment_id if current.start_ms <= nxt.start_ms else nxt.first_segment_id
                current = Hit(
                    recording_id=current.recording_id,
                    recording_title=current.recording_title,
                    kind=current.kind,
                    created_at=current.created_at,
                    first_segment_id=earliest_seg_id,
                    start_ms=min(current.start_ms, nxt.start_ms),
                    end_ms=max(current.end_ms, nxt.end_ms),
                    text=f"{current.text}\n{nxt.text}",
                    distance=min(current.distance, nxt.distance),
                )
            else:
                merged_hits.append(current)
                current = nxt
        merged_hits.append(current)

    merged_hits.sort(key=lambda h: h.distance)
    return merged_hits
