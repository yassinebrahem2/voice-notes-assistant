from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.api.errors import ErrorBody


class ChatOut(BaseModel):
    id: str
    created_at: datetime


class CitationOut(BaseModel):
    n: int
    recording_id: str
    segment_id: str
    start_ms: int
    recording_title: str


class MessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    text: str
    reply_type: Literal["answer", "greeting", "help", "out_of_scope"] | None
    citations: list[CitationOut]
    created_at: datetime


class ChatDetailOut(BaseModel):
    id: str
    messages: list[MessageOut]


class AskIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    scope: Literal["notes", "meetings", "both"]
    tag_ids: list[str] = Field(default_factory=list)


class RunAcceptedOut(BaseModel):
    run_id: str


class RunOut(BaseModel):
    status: Literal["running", "done", "failed"]
    steps: list[str]
    message: MessageOut | None
    error: ErrorBody | None
