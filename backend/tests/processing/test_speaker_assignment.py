import string

import pytest

from app.processing.speakers import assign_speakers
from app.speech.protocols import AsrSegment, DiarTurn


def _seg(start_ms: int, end_ms: int) -> AsrSegment:
    return AsrSegment(start_ms, end_ms, "text")


def test_assign_speakers_overlap_and_nearest() -> None:
    turns = [DiarTurn(0, 1000, "spk_x"), DiarTurn(1000, 3000, "spk_y"), DiarTurn(5000, 6000, "spk_x")]
    segments = [
        _seg(0, 900),  # inside the first turn
        _seg(800, 2500),  # 200 ms with x, 1500 ms with y: largest overlap wins
        _seg(3200, 3400),  # no overlap: y ends 200 ms before, x starts 1600 ms after
        _seg(4500, 4900),  # no overlap: x starts 100 ms after, y ended 1500 ms before
    ]

    assert assign_speakers(segments, turns) == ["A", "B", "B", "A"]


def test_labels_by_first_appearance() -> None:
    # The diarizer's own names and order do not decide the labels; the transcript order does.
    turns = [DiarTurn(0, 1000, "SPEAKER_07"), DiarTurn(1000, 2000, "SPEAKER_02"), DiarTurn(2000, 3000, "SPEAKER_05")]
    segments = [_seg(1100, 1900), _seg(2100, 2900), _seg(100, 900), _seg(1200, 1300)]

    assert assign_speakers(segments, turns) == ["A", "B", "C", "A"]


def test_ties_go_to_the_earliest_turn() -> None:
    turns = [DiarTurn(0, 1000, "first"), DiarTurn(1000, 2000, "second"), DiarTurn(3000, 4000, "third")]
    # Equal overlap with the first two turns, then equal distance to the second and third.
    segments = [_seg(500, 1500), _seg(2400, 2600)]

    assert assign_speakers(segments, turns) == ["A", "B"]


def test_no_segments_gives_no_labels() -> None:
    assert assign_speakers([], [DiarTurn(0, 1000, "x")]) == []


def test_segments_without_turns_raise() -> None:
    # No silent fallback to one speaker: the meeting must fail instead.
    with pytest.raises(ValueError, match="turns"):
        assign_speakers([_seg(0, 1000)], [])


def test_more_than_26_speakers_raise() -> None:
    turns = [DiarTurn(i * 1000, (i + 1) * 1000, f"s{i}") for i in range(27)]
    segments = [_seg(i * 1000 + 100, i * 1000 + 900) for i in range(27)]

    assert assign_speakers(segments[:26], turns) == list(string.ascii_uppercase)
    with pytest.raises(ValueError, match="26"):
        assign_speakers(segments, turns)
