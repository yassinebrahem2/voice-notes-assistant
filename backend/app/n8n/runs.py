"""Thread-safe registry for live chat run contexts."""

from __future__ import annotations

import secrets
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agents.chat_context import ChatContext

_LOCK = threading.Lock()
_RUNS: dict[str, ChatContext] = {}


def register(ctx: ChatContext) -> str:
    """Register an active ChatContext under a new run_id."""
    run_id = secrets.token_urlsafe(16)
    with _LOCK:
        _RUNS[run_id] = ctx
    return run_id


def lookup(run_id: str) -> ChatContext | None:
    """Look up an active ChatContext by run_id."""
    with _LOCK:
        return _RUNS.get(run_id)


def unregister(run_id: str) -> None:
    """Remove a run_id from the registry."""
    with _LOCK:
        _RUNS.pop(run_id, None)
