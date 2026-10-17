from pydantic import BaseModel


class Citation(BaseModel):
    recording_id: str
    segment_id: str
    start_ms: int


class AnalysisItem(BaseModel):
    text: str
    citations: list[Citation]


class AnalysisActionItem(AnalysisItem):
    owner_speaker_id: str | None
    due: str | None


class MeetingSummary(BaseModel):
    overview: str
    decisions: list[AnalysisItem]
    action_items: list[AnalysisActionItem]
    open_questions: list[AnalysisItem]


class NoteContent(BaseModel):
    key_points: list[AnalysisItem]
    clean_text: str
