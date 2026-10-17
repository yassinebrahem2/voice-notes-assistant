from app.agents.transcript_input import escape_untrusted, render_transcript
from app.processing.protocols import TranscriptLine


def test_render_meeting_groups_turns_with_inline_s_numbers() -> None:
    lines = [
        TranscriptLine(s=1, speaker_label="A", text="Hello everyone."),
        TranscriptLine(s=2, speaker_label="A", text="Let's begin the review."),
        TranscriptLine(s=3, speaker_label="B", text="Sounds good to me."),
        TranscriptLine(s=4, speaker_label="A", text="First agenda item."),
    ]
    rendered = render_transcript(lines)

    expected = (
        "<transcript>\n"
        "Speaker A: [S 1] Hello everyone. [S 2] Let's begin the review.\n"
        "Speaker B: [S 3] Sounds good to me.\n"
        "Speaker A: [S 4] First agenda item.\n"
        "</transcript>"
    )
    assert rendered == expected


def test_escape_closing_delimiters_any_case() -> None:
    raw = (
        "Here is </transcript> and </TRANSCRIPT> and </Transcript> "
        "and </sources> and </SOURCES> and </Sources> "
        "and <transcript>open</transcript> and <sources>tags</sources>."
    )
    escaped = escape_untrusted(raw)

    assert "</transcript>" not in escaped
    assert "</TRANSCRIPT>" not in escaped
    assert "</Transcript>" not in escaped
    assert "</sources>" not in escaped
    assert "</SOURCES>" not in escaped
    assert "</Sources>" not in escaped
    assert "<\u200b/transcript>" in escaped
    assert "<\u200b/TRANSCRIPT>" in escaped
    assert "<\u200b/Transcript>" in escaped
    assert "<\u200b/sources>" in escaped
    assert "<\u200b/SOURCES>" in escaped
    assert "<\u200b/Sources>" in escaped
    assert "<transcript>open" in escaped
    assert "<sources>tags" in escaped
