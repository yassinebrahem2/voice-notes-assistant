from typing import Literal

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


class ChatReply(BaseModel):
    reply_type: Literal["answer", "greeting", "help", "out_of_scope"]
    text: str | None
