from dataclasses import dataclass
from typing import Protocol

from app.agents.schemas import MeetingAnalysis, NoteAnalysis
from app.domain.types import RecordingKind


@dataclass
class TranscriptLine:
    s: int
    speaker_label: str | None
    text: str


@dataclass
class AnalysisRequest:
    kind: RecordingKind
    lines: list[TranscriptLine]
    tag_vocabulary: list[str]


class Analyzer(Protocol):
    def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis: ...
