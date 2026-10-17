from collections.abc import Sequence

from app.rag.chunker import ChunkDraft, SegmentRow, chunk_segments

# Text sizes keep wide margins from every limit, so rounding chars/4 either way cannot change a result.


def _segments(spec: Sequence[tuple[str | None, int]]) -> list[SegmentRow]:
    """One segment per (speaker label, token count), each 1 s long and with text unique to its position."""
    return [
        SegmentRow(
            id=f"seg_{idx}",
            idx=idx,
            start_ms=idx * 1000,
            end_ms=idx * 1000 + 900,
            speaker_label=label,
            text=f"s{idx:02d}" + "x" * (tokens * 4 - 3),
        )
        for idx, (label, tokens) in enumerate(spec)
    ]


def _spans(chunks: list[ChunkDraft]) -> list[tuple[int, int]]:
    return [(chunk.first_idx, chunk.last_idx) for chunk in chunks]


def test_chunks_never_split_segments_and_overlap_one() -> None:
    segments = _segments([(None, 100)] * 10)

    chunks = chunk_segments(segments, "note", max_tokens=250, min_tokens_at_speaker_change=80)

    assert _spans(chunks) == [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8), (8, 9)]
    for chunk in chunks:
        assert chunk.text == "\n".join(s.text for s in segments[chunk.first_idx : chunk.last_idx + 1])
        assert chunk.start_ms == segments[chunk.first_idx].start_ms
        assert chunk.end_ms == segments[chunk.last_idx].end_ms
    assert chunk_segments(segments[:1], "note", max_tokens=250, min_tokens_at_speaker_change=80) == [
        ChunkDraft(first_idx=0, last_idx=0, start_ms=0, end_ms=900, text=segments[0].text)
    ]
    assert chunk_segments([], "note", max_tokens=250, min_tokens_at_speaker_change=80) == []


def test_overlap_chunk_that_adds_nothing_new_is_skipped() -> None:
    # The overlap segment (150) and the next one (100) do not fit together, so a chunk starting with the overlap
    # would repeat only the previous chunk's last segment; the next chunk starts after it instead.
    segments = _segments([(None, 40), (None, 150), (None, 100)])

    chunks = chunk_segments(segments, "note", max_tokens=200, min_tokens_at_speaker_change=80)

    assert _spans(chunks) == [(0, 1), (2, 2)]


def test_meeting_chunk_ends_at_speaker_change_after_min() -> None:
    segments = _segments([("A", 40), ("A", 60), ("B", 40), ("B", 40), ("A", 60), (None, 20)])

    chunks = chunk_segments(segments, "meeting", max_tokens=1000, min_tokens_at_speaker_change=80)

    # 40+60 reaches the minimum, so the change to B ends the first chunk; the second starts on the overlap (60),
    # which is under the minimum, so the change to B does not end it, and the change back to A at 140 does.
    assert _spans(chunks) == [(0, 1), (1, 3), (3, 4), (4, 5)]
    assert chunks[0].text == f"Speaker A: {segments[0].text}\nSpeaker A: {segments[1].text}"
    # A segment without a speaker is a plain line.
    assert chunks[3].text == f"Speaker A: {segments[4].text}\n{segments[5].text}"


def test_note_ignores_speaker_changes() -> None:
    segments = _segments([("A", 50), ("B", 50), ("A", 50)])

    chunks = chunk_segments(segments, "note", max_tokens=1000, min_tokens_at_speaker_change=80)

    assert _spans(chunks) == [(0, 2)]


def test_long_single_segment_is_its_own_chunk() -> None:
    segments = _segments([(None, 40), (None, 1000), (None, 40), (None, 40)])

    chunks = chunk_segments(segments, "note", max_tokens=200, min_tokens_at_speaker_change=80)

    assert _spans(chunks) == [(0, 0), (1, 1), (2, 3)]
    assert chunks[1].text == segments[1].text
    only_long = chunk_segments(segments[1:2], "note", max_tokens=200, min_tokens_at_speaker_change=80)
    assert _spans(only_long) == [(1, 1)]


def test_note_chunks_plain_text() -> None:
    segments = _segments([("A", 30), ("B", 30)])

    chunks = chunk_segments(segments, "note", max_tokens=200, min_tokens_at_speaker_change=80)

    assert [chunk.text for chunk in chunks] == [f"{segments[0].text}\n{segments[1].text}"]
    assert "Speaker" not in chunks[0].text
