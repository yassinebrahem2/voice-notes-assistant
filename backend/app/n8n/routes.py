"""Callback routes for n8n tools to execute search, find, and summarize."""

from __future__ import annotations

import hmac
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, cast

from fastapi import APIRouter, HTTPException, Request
from langchain.tools import ToolRuntime
from pydantic import BaseModel, SecretStr

from app.agents.chat_context import ChatContext
from app.agents.tools import find_recordings, search_transcripts, summarize
from app.n8n.runs import lookup

if TYPE_CHECKING:
    from app.n8n.client import N8nClient


class SearchTranscriptsIn(BaseModel):
    run_id: str
    query: str
    k: int = 8


class FindRecordingsIn(BaseModel):
    run_id: str
    text: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    tags: list[str] | None = None


class SummarizeIn(BaseModel):
    run_id: str
    sources: list[str]
    focus: str | None = None


def build_router(client: N8nClient, secret: SecretStr) -> APIRouter:
    """Build the callback router mounted at /internal/n8n/tools."""
    router = APIRouter(prefix="/internal/n8n/tools", include_in_schema=False)

    def _verify_secret(request: Request) -> None:
        header_val = request.headers.get("X-N8N-Secret")
        if not header_val or not hmac.compare_digest(header_val.encode(), secret.get_secret_value().encode()):
            raise HTTPException(status_code=401, detail="Unauthorized")

    def _get_context(run_id: str) -> ChatContext:
        ctx = lookup(run_id)
        if ctx is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return ctx

    def _build_runtime(ctx: ChatContext) -> ToolRuntime[ChatContext, Any]:
        return ToolRuntime(
            state={},
            context=ctx,
            config={},
            stream_writer=lambda _: None,
            tool_call_id="n8n",
            store=None,
            tools=[],
        )

    @router.post("/search_transcripts")
    def handle_search_transcripts(request: Request, body: SearchTranscriptsIn) -> dict[str, str]:
        _verify_secret(request)
        ctx = _get_context(body.run_id)
        runtime = _build_runtime(ctx)
        search_func = cast(Callable[..., str] | None, getattr(search_transcripts, "func", None))
        if search_func is None:
            raise RuntimeError("search_transcripts.func is None")
        text = search_func(query=body.query, k=body.k, runtime=runtime)
        return {"result": text}

    @router.post("/find_recordings")
    def handle_find_recordings(request: Request, body: FindRecordingsIn) -> dict[str, str]:
        _verify_secret(request)
        ctx = _get_context(body.run_id)
        runtime = _build_runtime(ctx)
        find_func = cast(Callable[..., str] | None, getattr(find_recordings, "func", None))
        if find_func is None:
            raise RuntimeError("find_recordings.func is None")
        text = find_func(
            text=body.text,
            date_from=body.date_from,
            date_to=body.date_to,
            tags=body.tags,
            runtime=runtime,
        )
        return {"result": text}

    @router.post("/summarize")
    async def handle_summarize(request: Request, body: SummarizeIn) -> dict[str, str]:
        _verify_secret(request)
        ctx = _get_context(body.run_id)
        runtime = _build_runtime(ctx)
        summarize_coro = cast(Callable[..., Awaitable[str]] | None, getattr(summarize, "coroutine", None))
        if summarize_coro is None:
            raise RuntimeError("summarize.coroutine is None")
        text = await summarize_coro(sources=body.sources, focus=body.focus, runtime=runtime)
        return {"result": text}

    return router
