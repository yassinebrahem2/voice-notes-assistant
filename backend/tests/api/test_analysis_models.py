import pytest
from pydantic import ValidationError

from app.agents.schemas import NoteAnalysis
from app.domain.analysis import MeetingSummary, NoteContent


def test_empty_stored_meeting_analysis_is_valid() -> None:
    summary = MeetingSummary(overview="No speech detected.", decisions=[], action_items=[], open_questions=[])
    assert MeetingSummary.model_validate(summary.model_dump()) == summary


def test_empty_stored_note_analysis_is_valid() -> None:
    note = NoteContent(key_points=[], clean_text="")
    assert NoteContent.model_validate(note.model_dump()) == note
    with pytest.raises(ValidationError):
        NoteAnalysis(title="Empty note", tags=[], key_points=[], clean_text="")
