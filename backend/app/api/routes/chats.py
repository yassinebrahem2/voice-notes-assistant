import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_container, get_db
from app.api.errors import ApiError, ErrorCode
from app.api.models.chats import AskIn, ChatDetailOut, ChatOut, RunAcceptedOut, RunOut
from app.chats.store import add_user_message
from app.chats.store import create_chat as store_create_chat
from app.chats.store import get_chat as store_get_chat
from app.container import Container

router = APIRouter(prefix="/chats", tags=["chats"])


@router.post("", status_code=201, response_model=ChatOut, operation_id="create_chat")
def create_chat(conn: Annotated[sqlite3.Connection, Depends(get_db)]) -> ChatOut:
    return store_create_chat(conn)


@router.get("/{chat_id}", response_model=ChatDetailOut, operation_id="get_chat")
def get_chat(chat_id: str, conn: Annotated[sqlite3.Connection, Depends(get_db)]) -> ChatDetailOut:
    return store_get_chat(conn, chat_id)


@router.post("/{chat_id}/messages", status_code=202, response_model=RunAcceptedOut, operation_id="ask_chat")
async def ask_chat(
    chat_id: str,
    question: AskIn,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    container: Annotated[Container, Depends(get_container)],
) -> RunAcceptedOut:
    msg_id = add_user_message(conn, chat_id, question)
    if container.chat_runs is None:
        raise ApiError(500, ErrorCode.internal_error, "Chat runs manager not configured")
    container.chat_runs.start(chat_id, msg_id)
    return RunAcceptedOut(run_id=msg_id)


@router.get("/{chat_id}/runs/{run_id}", response_model=RunOut, operation_id="get_run")
def get_run(
    chat_id: str,
    run_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> RunOut:
    if container.chat_runs is None:
        raise ApiError(500, ErrorCode.internal_error, "Chat runs manager not configured")
    run = container.chat_runs.get(run_id)
    if run is None or run.chat_id != chat_id:
        raise ApiError(404, ErrorCode.not_found, "Run not found")
    return RunOut(
        status=run.status,
        steps=run.steps,
        message=run.message,
        error=run.error,
    )


@router.post("/{chat_id}/runs/{run_id}/retry", status_code=202, response_model=RunAcceptedOut, operation_id="retry_run")
async def retry_run(
    chat_id: str,
    run_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> RunAcceptedOut:
    if container.chat_runs is None:
        raise ApiError(500, ErrorCode.internal_error, "Chat runs manager not configured")
    container.chat_runs.retry(chat_id, run_id)
    return RunAcceptedOut(run_id=run_id)
