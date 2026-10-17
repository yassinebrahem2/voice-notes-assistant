"""Transcript formatting and untrusted text escaping for agent inputs."""

import re
from itertools import groupby

from app.processing.protocols import TranscriptLine


def escape_untrusted(text: str) -> str:
    """Neutralise closing delimiters </transcript> and </sources> in untrusted text.

    Inserts a zero-width space after '<' regardless of case or whitespace.
    """
    return re.sub(
        r"(?i)<\s*/\s*(transcript|sources)",
        lambda m: f"<\u200b/{m.group(1)}",
        text,
    )


def render_transcript(lines: list[TranscriptLine]) -> str:
    """Render transcript lines wrapped in <transcript> tags.

    Meetings (with speaker labels) are grouped by turn: 'Speaker X:' once per turn
    with inline '[S n]' before each segment.
    Notes (without speaker labels) format each segment with '[S n]' on separate lines.
    Closing delimiters in untrusted text are escaped.
    """
    if not lines:
        return "<transcript>\n</transcript>"

    is_meeting = any(line.speaker_label is not None for line in lines)
    if not is_meeting:
        body = "\n".join(f"[S {line.s}] {escape_untrusted(line.text)}" for line in lines)
        return f"<transcript>\n{body}\n</transcript>"

    turn_blocks: list[str] = []
    for speaker_label, group in groupby(lines, key=lambda line_item: line_item.speaker_label):
        group_lines = list(group)
        segments_str = " ".join(f"[S {item.s}] {escape_untrusted(item.text)}" for item in group_lines)
        if speaker_label is not None:
            turn_blocks.append(f"Speaker {speaker_label}: {segments_str}")
        else:
            turn_blocks.append(segments_str)

    body = "\n".join(turn_blocks)
    return f"<transcript>\n{body}\n</transcript>"
