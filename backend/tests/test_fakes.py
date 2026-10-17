import math
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from app.agents.schemas import ActionItem, ChatReply, Item, MeetingAnalysis, NoteAnalysis
from app.processing.fakes import FakeAnalyzer
from app.processing.protocols import AnalysisRequest, TranscriptLine
from app.rag.fakes import FakeEmbedder
from app.speech.fakes import FakeAsr, FakeDiarizer


@pytest.mark.parametrize("samples", [0, 1, 160_000])
def test_fake_speech_scales_to_audio(tmp_path: Path, samples: int) -> None:
    path = tmp_path / "audio.npy"
    np.save(path, np.zeros(samples, dtype=np.float32))
    segments = FakeAsr().transcribe(path)
    turns = FakeDiarizer().diarize(path)
    if samples == 0:
        assert segments == turns == []
        return
    assert len(segments) == len(turns) == 6
    assert segments == sorted(segments, key=lambda segment: segment.start_ms)
    assert {turn.speaker for turn in turns} == {"A", "B"}
    for segment, turn in zip(segments, turns, strict=True):
        assert 0 <= segment.start_ms <= segment.end_ms <= samples * 1000 // 16000
        assert (segment.start_ms, segment.end_ms) == (turn.start_ms, turn.end_ms)


def test_fake_embedder_deterministic_unit_vectors() -> None:
    embedder = FakeEmbedder()
    first = embedder.embed_query("hello")
    assert len(first) == embedder.dim == 384
    assert math.sqrt(sum(value * value for value in first)) == pytest.approx(1)
    assert embedder.embed_query("hello") == first
    assert FakeEmbedder().embed_query("hello") == first
    assert embedder.embed_query("different") != first
    assert embedder.embed_passages(["hello", "different"]) == [first, embedder.embed_query("different")]
    assert embedder.embed_passages([]) == []


def test_fake_analyzer_validates() -> None:
    lines = [TranscriptLine(1, "A", "Discuss the plan."), TranscriptLine(2, "B", "Ship on Friday.")]
    meeting = FakeAnalyzer().analyze(AnalysisRequest("meeting", lines, []))
    assert isinstance(meeting, MeetingAnalysis)
    assert MeetingAnalysis.model_validate(meeting.model_dump()) == meeting
    assert meeting.title == "Fake analysis"
    assert meeting.tags == ["demo"]
    for items in (meeting.decisions, meeting.action_items, meeting.open_questions):
        assert len(items) == 1 and items[0].sources == [1]
    note = FakeAnalyzer().analyze(AnalysisRequest("note", lines, []))
    assert isinstance(note, NoteAnalysis)
    assert len(note.key_points) == 1 and note.key_points[0].sources == [1]
    assert note.clean_text == "Discuss the plan. Ship on Friday."


def test_note_analysis_allows_one_key_point() -> None:
    assert (
        len(
            NoteAnalysis(
                title="Note", tags=["demo"], key_points=[Item(text="Point", sources=[1])], clean_text="Point"
            ).key_points
        )
        == 1
    )


@pytest.mark.parametrize("sources", [[], [1, 2, 3, 4]])
def test_item_source_limits(sources: list[int]) -> None:
    with pytest.raises(ValidationError):
        Item(text="Point", sources=sources)


def test_analysis_schema_limits() -> None:
    with pytest.raises(ValidationError):
        NoteAnalysis(title="x" * 61, tags=["demo"], key_points=[Item(text="Point", sources=[1])], clean_text="")
    with pytest.raises(ValidationError):
        NoteAnalysis(title="Note", tags=[], key_points=[Item(text="Point", sources=[1])], clean_text="")
    with pytest.raises(ValidationError):
        NoteAnalysis(title="Note", tags=["demo"], key_points=[], clean_text="")
    with pytest.raises(ValidationError):
        NoteAnalysis(title="Note", tags=["demo"], key_points=[Item(text="Point", sources=[1])] * 9, clean_text="")
    assert ActionItem(text="Do it", sources=[1], owner=None, due=None).owner is None
    assert ChatReply(reply_type="greeting", text=None).text is None
