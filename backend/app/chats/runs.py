"""Chat runs manager coordinating background graph execution, polling, and retries."""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Literal, cast

import httpx
import openai
from langchain_core.exceptions import ModelError
from langchain_core.messages import HumanMessage
from langgraph.graph.state import CompiledStateGraph  # pyright: ignore[reportMissingTypeStubs]

from app.agents.chat_context import ChatContext
from app.agents.citations import FinalReply
from app.agents.sources import SourceRegistry
from app.api.errors import ApiError, ErrorBody, ErrorCode
from app.api.models.chats import CitationOut, MessageOut
from app.chats.store import add_assistant_message, history_for
from app.config import ConfigError
from app.db.connection import connect

if TYPE_CHECKING:
    from app.container import Container

logger = logging.getLogger(__name__)


def _is_ai_unavailable(exc: BaseException) -> bool:
    """Return True if the exception was caused by an AI provider or config failure."""
    if isinstance(exc, (ModelError, httpx.TimeoutException, httpx.TransportError, openai.OpenAIError, ConfigError)):
        return True
    if exc.__cause__ is not None and _is_ai_unavailable(exc.__cause__):
        return True
    return bool(exc.__context__ is not None and _is_ai_unavailable(exc.__context__))


MAX_FINISHED_RUNS = 100


@dataclass
class RunState:
    chat_id: str
    status: Literal["running", "done", "failed"]
    steps: list[str] = field(default_factory=lambda: cast(list[str], []))
    message: MessageOut | None = None
    error: ErrorBody | None = None
    task: asyncio.Task[None] | None = None


class ChatRuns:
    """In-memory manager for background chat execution runs."""

    def __init__(
        self,
        container: "Container",
        graph_factory: Callable[["Container"], CompiledStateGraph[Any, Any, Any, Any]],
    ) -> None:
        self._container = container
        self._graph_factory = graph_factory
        self._graph: CompiledStateGraph[Any, Any, Any, Any] | None = None
        self._runs: dict[str, RunState] = {}
        self._finished_run_ids: list[str] = []

    def _get_graph(self) -> CompiledStateGraph[Any, Any, Any, Any]:
        if self._graph is None:
            self._graph = self._graph_factory(self._container)
        return self._graph

    def get(self, run_id: str) -> RunState | None:
        return self._runs.get(run_id)

    @property
    def runs(self) -> dict[str, RunState]:
        return self._runs

    def record_finished(self, run_id: str) -> None:
        if run_id in self._finished_run_ids:
            self._finished_run_ids.remove(run_id)
        self._finished_run_ids.append(run_id)
        while len(self._finished_run_ids) > MAX_FINISHED_RUNS:
            oldest_id = self._finished_run_ids.pop(0)
            run = self._runs.get(oldest_id)
            if run is not None and run.status in ("done", "failed"):
                del self._runs[oldest_id]

    def start(self, chat_id: str, msg_id: str) -> None:
        if msg_id in self._finished_run_ids:
            self._finished_run_ids.remove(msg_id)
        state = RunState(chat_id=chat_id, status="running", steps=[])
        self._runs[msg_id] = state
        state.task = asyncio.create_task(self._execute(chat_id, msg_id, state))

    async def _execute(self, chat_id: str, msg_id: str, state: RunState) -> None:
        try:
            timeout_s = self._container.settings.chat_deadline_s
            async with asyncio.timeout(timeout_s):
                conn = connect(self._container.db_path)
                try:
                    row = conn.execute(
                        "SELECT text, scope, tag_ids FROM messages WHERE id = ? AND chat_id = ?",
                        (msg_id, chat_id),
                    ).fetchone()
                    if row is None:
                        raise ApiError(404, ErrorCode.not_found, "Message not found")
                    user_text: str = row["text"]
                    scope: Literal["notes", "meetings", "both"] = row["scope"] or "both"
                    raw_tags = row["tag_ids"]
                    tag_ids: list[str] = json.loads(raw_tags) if raw_tags else []

                    history = history_for(conn, chat_id, before_msg_id=msg_id, turns=6)
                finally:
                    conn.close()

                ctx = ChatContext(
                    db_path=self._container.db_path,
                    embedder=self._container.embedder,
                    settings=self._container.settings,
                    models=self._container.models,
                    scope=scope,
                    tag_ids=tag_ids,
                    today=date.today(),
                    sources=SourceRegistry(),
                )

                graph = self._get_graph()
                input_state = {"messages": [*history, HumanMessage(content=user_text)]}

                final_reply: FinalReply | None = None
                graph_any = cast(Any, graph)
                stream = graph_any.astream(
                    input_state,
                    context=ctx,
                    stream_mode=["custom", "values"],
                    subgraphs=True,
                )
                async for chunk in stream:
                    chunk_item = cast(tuple[tuple[str, ...], str, Any], chunk)
                    namespace, mode, payload = chunk_item
                    if mode == "custom":
                        if isinstance(payload, str):
                            state.steps.append(payload)
                    elif mode == "values" and namespace == () and isinstance(payload, dict):
                        payload_dict = cast(dict[str, Any], payload)
                        if payload_dict.get("structured_response") is not None and "Writing answer…" not in state.steps:
                            state.steps.append("Writing answer…")
                        raw_final = payload_dict.get("final")
                        if isinstance(raw_final, FinalReply):
                            final_reply = raw_final

                if "Writing answer…" not in state.steps:
                    state.steps.append("Writing answer…")

                if final_reply is None:
                    raise RuntimeError("Graph completed without producing a FinalReply")

                conn = connect(self._container.db_path)
                try:
                    msg_out = add_assistant_message(conn, chat_id, final_reply)
                finally:
                    conn.close()

                state.message = msg_out
                state.status = "done"
                self.record_finished(msg_id)

        except TimeoutError:
            state.status = "failed"
            state.error = ErrorBody(code=ErrorCode.timed_out, message="That took too long.")
            self.record_finished(msg_id)
        except Exception as exc:
            if _is_ai_unavailable(exc):
                state.status = "failed"
                state.error = ErrorBody(code=ErrorCode.ai_unavailable, message="Couldn't reach the AI right now.")
            else:
                logger.exception("Chat run %s failed with unexpected error: %s", msg_id, exc)
                state.status = "failed"
                state.error = ErrorBody(code=ErrorCode.internal_error, message="Internal error")
            self.record_finished(msg_id)

    def retry(self, chat_id: str, run_id: str) -> None:
        if run_id in self._runs:
            run = self._runs[run_id]
            if run.chat_id != chat_id:
                raise ApiError(404, ErrorCode.not_found, "Run not found")
            if run.status in ("running", "done"):
                raise ApiError(409, ErrorCode.not_failed, "Run is running or already completed")
            self.start(chat_id, run_id)
            return

        conn = connect(self._container.db_path)
        try:
            user_row = conn.execute(
                "SELECT rowid, created_at FROM messages WHERE id = ? AND chat_id = ? AND role = 'user'",
                (run_id, chat_id),
            ).fetchone()
            if user_row is None:
                raise ApiError(404, ErrorCode.not_found, "Run not found")

            u_rowid = user_row["rowid"]
            u_created_at = user_row["created_at"]

            next_row = conn.execute(
                """SELECT id, role, text, reply_type, citations, created_at
                FROM messages
                WHERE chat_id = ? AND (created_at > ? OR (created_at = ? AND rowid > ?))
                ORDER BY created_at ASC, rowid ASC
                LIMIT 1""",
                (chat_id, u_created_at, u_created_at, u_rowid),
            ).fetchone()

            if next_row is not None and next_row["role"] == "assistant":
                citations_raw = next_row["citations"]
                citations: list[CitationOut] = []
                if citations_raw:
                    citations = [CitationOut.model_validate(c) for c in json.loads(citations_raw)]
                msg = MessageOut(
                    id=next_row["id"],
                    role="assistant",
                    text=next_row["text"],
                    reply_type=next_row["reply_type"],
                    citations=citations,
                    created_at=(
                        datetime.fromisoformat(next_row["created_at"])
                        if isinstance(next_row["created_at"], str)
                        else next_row["created_at"]
                    ),
                )
                self._runs[run_id] = RunState(chat_id=chat_id, status="done", steps=[], message=msg)
                self.record_finished(run_id)
                return

            self.start(chat_id, run_id)
        finally:
            conn.close()
