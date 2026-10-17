from app.domain.analysis import (
    AnalysisActionItem,
    AnalysisItem,
    Citation,
    MeetingSummary,
    NoteContent,
)
from app.domain.analysis_render import render_analysis


def test_render_analysis_meeting_and_note() -> None:
    id_to_display = {
        "spk_1": "Sarah",
        "spk_2": "Alex",
    }
    citation = Citation(recording_id="rec_1", segment_id="seg_1", start_ms=100)
    meeting = MeetingSummary(
        overview="Meeting between {{spk_1}} and {{spk_2}} regarding {{spk_unknown}}.",
        decisions=[
            AnalysisItem(text="{{spk_1}} agreed to ship.", citations=[citation]),
        ],
        action_items=[
            AnalysisActionItem(
                text="{{spk_2}} will write docs.",
                citations=[citation],
                owner_speaker_id="spk_2",
                due="2026-10-20",
            ),
        ],
        open_questions=[
            AnalysisItem(text="Did {{spk_1}} check tests?", citations=[]),
        ],
    )
    rendered_meeting = render_analysis(meeting, id_to_display)
    assert isinstance(rendered_meeting, MeetingSummary)
    assert rendered_meeting.overview == "Meeting between Sarah and Alex regarding {{spk_unknown}}."
    assert rendered_meeting.decisions[0].text == "Sarah agreed to ship."
    assert rendered_meeting.decisions[0].citations == [citation]
    assert rendered_meeting.action_items[0].text == "Alex will write docs."
    assert rendered_meeting.action_items[0].owner_speaker_id == "spk_2"
    assert rendered_meeting.action_items[0].due == "2026-10-20"
    assert rendered_meeting.action_items[0].citations == [citation]
    assert rendered_meeting.open_questions[0].text == "Did Sarah check tests?"

    note = NoteContent(
        key_points=[
            AnalysisItem(text="Key point by {{spk_1}}.", citations=[citation]),
            AnalysisItem(text="Second point {{spk_unknown}}.", citations=[]),
        ],
        clean_text="Clean text summarizing {{spk_1}} and {{spk_2}}.",
    )
    rendered_note = render_analysis(note, id_to_display)
    assert isinstance(rendered_note, NoteContent)
    assert rendered_note.key_points[0].text == "Key point by Sarah."
    assert rendered_note.key_points[0].citations == [citation]
    assert rendered_note.key_points[1].text == "Second point {{spk_unknown}}."
    assert rendered_note.clean_text == "Clean text summarizing Sarah and Alex."
