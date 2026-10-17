from pathlib import Path

import numpy as np

from app.speech.protocols import AsrSegment, DiarTurn

_CONVERSATION = (
    ("A", "Let's discuss the demo plan."),
    ("B", "We should start with recording."),
    ("A", "Agreed, recording comes first."),
    ("B", "I will prepare the demo on Friday."),
    ("A", "Which example should we use?"),
    ("B", "Let's decide at our next meeting."),
)


def _duration_ms(audio_npy: Path) -> int | None:
    samples = np.load(audio_npy, mmap_mode="r", allow_pickle=False).shape[0]
    return None if samples == 0 else int(samples * 1000 // 16_000)


class FakeAsr:
    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        duration = _duration_ms(audio_npy)
        if duration is None:
            return []
        count = len(_CONVERSATION)
        return [
            AsrSegment(index * duration // count, (index + 1) * duration // count, text)
            for index, (_, text) in enumerate(_CONVERSATION)
        ]


class FakeDiarizer:
    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        duration = _duration_ms(audio_npy)
        if duration is None:
            return []
        count = len(_CONVERSATION)
        return [
            DiarTurn(index * duration // count, (index + 1) * duration // count, speaker)
            for index, (speaker, _) in enumerate(_CONVERSATION)
        ]
