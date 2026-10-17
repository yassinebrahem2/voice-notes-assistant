"""Packs a recording's segments into the overlapping chunks that are embedded for retrieval."""

import math
import sqlite3
from dataclasses import dataclass

from app.domain.types import RecordingKind

# Only meetings have speakers, so a note never gets a label, even from a stray speaker row.
_SEGMENT_ROWS_SQL = """
SELECT s.id, s.idx, s.start_ms, s.end_ms, CASE r.kind WHEN 'meeting' THEN sp.label END AS label, s.text
FROM segments s
JOIN recordings r ON r.id = s.recording_id
LEFT JOIN speakers sp ON sp.id = s.speaker_id
WHERE s.recording_id = ?
ORDER BY s.idx
"""


@dataclass(frozen=True)
class SegmentRow:
    id: str
    idx: int
    start_ms: int
    end_ms: int
    speaker_label: str | None
    text: str


@dataclass(frozen=True)
class ChunkDraft:
    first_idx: int
    last_idx: int
    start_ms: int
    end_ms: int
    text: str


def load_segment_rows(conn: sqlite3.Connection, rec_id: str) -> list[SegmentRow]:
    """The recording's segments in order; notes have no speakers, so their label is None."""
    return [
        SegmentRow(row["id"], row["idx"], row["start_ms"], row["end_ms"], row["label"], row["text"])
        for row in conn.execute(_SEGMENT_ROWS_SQL, (rec_id,))
    ]


def _tokens(segment: SegmentRow) -> int:
    # About four characters per token is close enough to size chunks without loading a tokenizer.
    return math.ceil(len(segment.text) / 4)


def _line(segment: SegmentRow, kind: RecordingKind) -> str:
    # Labels, not names, so renaming a speaker never needs a re-index.
    if kind == "meeting" and segment.speaker_label is not None:
        return f"Speaker {segment.speaker_label}: {segment.text}"
    return segment.text


def _last_index(
    segments: list[SegmentRow], start: int, kind: RecordingKind, max_tokens: int, min_tokens_at_speaker_change: int
) -> int:
    """The position of the last segment of the chunk that starts at `start`."""
    end = start
    total = _tokens(segments[start])
    while end + 1 < len(segments):
        following = segments[end + 1]
        if total + _tokens(following) > max_tokens:
            break
        speaker_changes = following.speaker_label != segments[end].speaker_label
        if kind == "meeting" and speaker_changes and total >= min_tokens_at_speaker_change:
            break
        end += 1
        total += _tokens(following)
    return end


def chunk_segments(
    segments: list[SegmentRow], kind: RecordingKind, max_tokens: int, min_tokens_at_speaker_change: int
) -> list[ChunkDraft]:
    """Chunks of whole consecutive segments; each chunk after the first starts with the previous chunk's last one."""
    chunks: list[ChunkDraft] = []
    start = 0
    overlapping = False
    while start < len(segments):
        end = _last_index(segments, start, kind, max_tokens, min_tokens_at_speaker_change)
        if overlapping and end == start:
            # The overlap segment fits with nothing after it, so this chunk would only repeat it.
            start += 1
            overlapping = False
            continue
        part = segments[start : end + 1]
        chunks.append(
            ChunkDraft(
                first_idx=part[0].idx,
                last_idx=part[-1].idx,
                start_ms=part[0].start_ms,
                end_ms=part[-1].end_ms,
                text="\n".join(_line(segment, kind) for segment in part),
            )
        )
        if end == len(segments) - 1:
            break
        # A one-segment chunk cannot share its segment: the next chunk would start, and stop, on it again.
        overlapping = end > start
        start = end if overlapping else end + 1
    return chunks
