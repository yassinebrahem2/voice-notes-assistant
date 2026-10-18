"""Giving each transcript segment a speaker label from the diarizer's turns."""

import string

from app.speech.protocols import AsrSegment, DiarTurn

# Stored analysis text refers to speakers as "Speaker A".."Speaker Z", one letter each.
_LABELS = string.ascii_uppercase


def _overlap_ms(segment: AsrSegment, turn: DiarTurn) -> int:
    # Negative when the two do not overlap: then it is minus the gap between them.
    return min(segment.end_ms, turn.end_ms) - max(segment.start_ms, turn.start_ms)


def _best_turn(segment: AsrSegment, turns: list[DiarTurn]) -> DiarTurn:
    # Largest overlap and, when nothing overlaps, smallest gap are the same maximum; max keeps the first tie.
    return max(turns, key=lambda turn: _overlap_ms(segment, turn))


def assign_speakers(segments: list[AsrSegment], turns: list[DiarTurn]) -> list[str]:
    """Per segment, the speaker of the turn with the largest overlap, else of the nearest turn; ties go to the
    earliest turn. Labels are A, B... in order of first appearance in the transcript."""
    if segments and not turns:
        raise ValueError("The diarizer returned no turns for a transcript with segments.")
    labels: dict[str, str] = {}
    result: list[str] = []
    for segment in segments:
        speaker = _best_turn(segment, turns).speaker
        if speaker not in labels:
            if len(labels) == len(_LABELS):
                raise ValueError(f"More than {len(_LABELS)} speakers cannot be labelled.")
            labels[speaker] = _LABELS[len(labels)]
        result.append(labels[speaker])
    return result
