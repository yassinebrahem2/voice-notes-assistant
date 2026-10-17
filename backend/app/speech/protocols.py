from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class AsrSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class DiarTurn:
    start_ms: int
    end_ms: int
    speaker: str


class Asr(Protocol):
    def transcribe(self, audio_npy: Path) -> list[AsrSegment]: ...


class Diarizer(Protocol):
    def diarize(self, audio_npy: Path) -> list[DiarTurn]: ...
