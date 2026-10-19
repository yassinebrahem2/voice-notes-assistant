from typing import Literal, cast

from pydantic import BaseModel, Field


class Item(BaseModel):
    text: str
    sources: list[int] = Field(min_length=1, max_length=3)


class ActionItem(Item):
    owner: str | None
    due: str | None


class MeetingAnalysis(BaseModel):
    title: str = Field(max_length=60)
    tags: list[str] = Field(min_length=1, max_length=4)
    overview: str
    decisions: list[Item]
    action_items: list[ActionItem]
    open_questions: list[Item]


class NoteAnalysis(BaseModel):
    title: str = Field(max_length=60)
    tags: list[str] = Field(min_length=1, max_length=4)
    key_points: list[Item] = Field(min_length=1, max_length=8)
    clean_text: str


class MeetingSectionNotes(BaseModel):
    decisions: list[Item] = Field(default_factory=lambda: cast(list[Item], []))
    action_items: list[ActionItem] = Field(default_factory=lambda: cast(list[ActionItem], []))
    open_questions: list[Item] = Field(default_factory=lambda: cast(list[Item], []))


class NoteSectionNotes(BaseModel):
    key_points: list[Item] = Field(default_factory=lambda: cast(list[Item], []))
    clean_text: str = ""


class ChatReply(BaseModel):
    reply_type: Literal["answer", "not_found", "greeting", "help", "out_of_scope"]
    text: str | None


class ChatSummaryItem(BaseModel):
    text: str
    sources: list[str] = Field(min_length=1, max_length=3)


class ChatSummaryActionItem(ChatSummaryItem):
    owner: str | None = None
    due: str | None = None


class ChatSummary(BaseModel):
    overview: str
    decisions: list[ChatSummaryItem] = Field(default_factory=lambda: cast(list[ChatSummaryItem], []))
    action_items: list[ChatSummaryActionItem] = Field(default_factory=lambda: cast(list[ChatSummaryActionItem], []))
    open_questions: list[ChatSummaryItem] = Field(default_factory=lambda: cast(list[ChatSummaryItem], []))
