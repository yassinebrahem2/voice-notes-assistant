from fastapi import APIRouter

from app.api.errors import not_implemented
from app.api.models.chats import AskIn, ChatDetailOut, ChatOut, RunAcceptedOut, RunOut

router = APIRouter(prefix="/chats", tags=["chats"])


@router.post("", status_code=201, response_model=ChatOut, operation_id="create_chat")
def create_chat() -> ChatOut:
    not_implemented()


@router.get("/{chat_id}", response_model=ChatDetailOut, operation_id="get_chat")
def get_chat(chat_id: str) -> ChatDetailOut:
    not_implemented()


@router.post("/{chat_id}/messages", status_code=202, response_model=RunAcceptedOut, operation_id="ask_chat")
def ask_chat(chat_id: str, question: AskIn) -> RunAcceptedOut:
    not_implemented()


@router.get("/{chat_id}/runs/{run_id}", response_model=RunOut, operation_id="get_run")
def get_run(chat_id: str, run_id: str) -> RunOut:
    not_implemented()


@router.post("/{chat_id}/runs/{run_id}/retry", status_code=202, response_model=RunAcceptedOut, operation_id="retry_run")
def retry_run(chat_id: str, run_id: str) -> RunAcceptedOut:
    not_implemented()
