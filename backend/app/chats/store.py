"""Database store operations for chats and messages."""

import json
import re
import sqlite3
from datetime import UTC, datetime

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from app.agents.citations import FinalReply
from app.api.errors import ApiError, ErrorCode
from app.api.models.chats import AskIn, ChatDetailOut, ChatOut, CitationOut, MessageOut
from app.ids import new_id


def create_chat(conn: sqlite3.Connection) -> ChatOut:
    """Create a new chat conversation."""
    chat_id = new_id("cht")
    now = datetime.now(UTC)
    conn.execute("INSERT INTO chats (id, created_at) VALUES (?, ?)", (chat_id, now.isoformat()))
    conn.commit()
    return ChatOut(id=chat_id, created_at=now)


def get_chat(conn: sqlite3.Connection, chat_id: str) -> ChatDetailOut:
    """Retrieve chat conversation and its chronological message history."""
    chat_row = conn.execute("SELECT id, created_at FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if chat_row is None:
        raise ApiError(404, ErrorCode.not_found, f"Chat '{chat_id}' not found")

    rows = conn.execute(
        """SELECT id, role, text, reply_type, citations, created_at
        FROM messages
        WHERE chat_id = ?
        ORDER BY created_at ASC, rowid ASC""",
        (chat_id,),
    ).fetchall()

    messages: list[MessageOut] = []
    for r in rows:
        citations_raw = r["citations"]
        citations: list[CitationOut] = []
        if citations_raw:
            citations = [CitationOut.model_validate(c) for c in json.loads(citations_raw)]
        created_at = datetime.fromisoformat(r["created_at"]) if isinstance(r["created_at"], str) else r["created_at"]
        messages.append(
            MessageOut(
                id=r["id"],
                role=r["role"],
                text=r["text"],
                reply_type=r["reply_type"],
                citations=citations,
                created_at=created_at,
            )
        )

    return ChatDetailOut(id=chat_id, messages=messages)


def add_user_message(conn: sqlite3.Connection, chat_id: str, ask: AskIn) -> str:
    """Record a user question in the chat, verifying the chat exists."""
    chat_row = conn.execute("SELECT 1 FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if chat_row is None:
        raise ApiError(404, ErrorCode.not_found, f"Chat '{chat_id}' not found")

    msg_id = new_id("msg")
    now = datetime.now(UTC)
    tag_ids_json = json.dumps(ask.tag_ids) if ask.tag_ids else None
    conn.execute(
        """INSERT INTO messages (id, chat_id, role, text, citations, reply_type, scope, tag_ids, created_at)
        VALUES (?, ?, 'user', ?, NULL, NULL, ?, ?, ?)""",
        (msg_id, chat_id, ask.text, ask.scope, tag_ids_json, now.isoformat()),
    )
    conn.commit()
    return msg_id


def add_assistant_message(conn: sqlite3.Connection, chat_id: str, final: FinalReply) -> MessageOut:
    """Record the assistant's verified reply in the chat."""
    msg_id = new_id("msg")
    now = datetime.now(UTC)
    citations_json = json.dumps([c.model_dump() for c in final.citations]) if final.citations else None
    conn.execute(
        """INSERT INTO messages (id, chat_id, role, text, reply_type, citations, scope, tag_ids, created_at)
        VALUES (?, ?, 'assistant', ?, ?, ?, NULL, NULL, ?)""",
        (msg_id, chat_id, final.text, final.reply_type, citations_json, now.isoformat()),
    )
    conn.commit()
    return MessageOut(
        id=msg_id,
        role="assistant",
        text=final.text,
        reply_type=final.reply_type,
        citations=final.citations,
        created_at=now,
    )


def _render_history_assistant(text: str, citations_raw: str | None) -> str:
    if not citations_raw:
        return text
    citations_data: list[object] = json.loads(citations_raw)
    citations_by_n: dict[int, CitationOut] = {
        c.n: c for c in [CitationOut.model_validate(item) for item in citations_data]
    }

    def replace_citation(match: re.Match[str]) -> str:
        n = int(match.group(1))
        c = citations_by_n.get(n)
        if c is not None:
            sec = max(0, c.start_ms) // 1000
            time_str = f"{sec // 60:02d}:{sec % 60:02d}"
            return f"({c.recording_title}, {time_str})"
        return match.group(0)

    return re.sub(r"\[\s*(\d+)\s*\]", replace_citation, text)


def history_for(
    conn: sqlite3.Connection,
    chat_id: str,
    before_msg_id: str,
    turns: int = 6,
) -> list[BaseMessage]:
    """Retrieve up to `turns` conversation turns before `before_msg_id` in chronological order.

    Assistant citations are rendered as plain text (e.g. `(Recording Title, 01:23)`).
    """
    limit = turns * 2
    target_row = conn.execute(
        "SELECT rowid, created_at FROM messages WHERE id = ? AND chat_id = ?",
        (before_msg_id, chat_id),
    ).fetchone()

    if target_row is not None:
        rows = conn.execute(
            """SELECT id, role, text, reply_type, citations, created_at, rowid
            FROM messages
            WHERE chat_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?""",
            (chat_id, target_row["created_at"], target_row["created_at"], target_row["rowid"], limit),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, role, text, reply_type, citations, created_at, rowid
            FROM messages
            WHERE chat_id = ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?""",
            (chat_id, limit),
        ).fetchall()

    chronological_rows = list(reversed(rows))
    result: list[BaseMessage] = []
    for r in chronological_rows:
        if r["role"] == "user":
            result.append(HumanMessage(content=r["text"]))
        elif r["role"] == "assistant":
            rendered = _render_history_assistant(r["text"], r["citations"])
            result.append(AIMessage(content=rendered))
    return result
