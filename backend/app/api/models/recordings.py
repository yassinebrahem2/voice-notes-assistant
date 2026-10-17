from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.api.errors import ErrorCode
from app.api.models.tags import TagOut
from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.types import RecordingKind, RecordingStatus


class RecordingOut(BaseModel):
    id: str
    kind: RecordingKind
    title: str | None
    status: RecordingStatus
    failed_step: Literal["decoding", "transcribing", "diarizing", "analyzing", "indexing"] | None
    error_code: ErrorCode | None
    error_message: str | None
    created_at: datetime
    duration_ms: int | None
    tags: list[TagOut]
    waveform_peaks: list[float] | None
    processing: bool


class SpeakerOut(BaseModel):
    id: str
    label: str
    name: str | None
    display_name: str


class SegmentOut(BaseModel):
    id: str
    idx: int
    start_ms: int
    end_ms: int
    speaker_id: str | None
    text: str


class RecordingDetailOut(RecordingOut):
    speakers: list[SpeakerOut]
    segments: list[SegmentOut]
    summary: MeetingSummary | None
    note: NoteContent | None


class RecordingPatchIn(BaseModel):
    title: str | None = Field(None, max_length=60)
    tags: list[str] | None = Field(None, max_length=4)


class SpeakerPatchIn(BaseModel):
    name: str = Field(max_length=40)
