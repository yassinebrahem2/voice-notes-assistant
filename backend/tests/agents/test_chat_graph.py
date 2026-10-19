import asyncio
from datetime import date
from typing import Any, cast

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.agents.chat_context import ChatContext
from app.agents.chat_graph import build_chat_graph
from app.agents.citations import NOT_FOUND, FinalReply
from app.agents.schemas import ChatReply
from app.agents.sources import SourceRegistry
from app.container import Container
from app.db.connection import connect
from tests.agents.fake_models import ScriptedChatModel
from tests.seed import seed_chunk, seed_recording


def test_final_answer_forced_on_ninth_turn(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    # A model that calls search_transcripts on turns 1..8.
    # On turn 9, ForceOutputToolMiddleware overrides tools=[] leaving only ChatReply.
    messages = [
        AIMessage(
            content="",
            tool_calls=[{"name": "search_transcripts", "args": {"query": f"search {i}"}, "id": f"call_{i}"}],
        )
        for i in range(1, 9)
    ]
    forced_reply = ChatReply(reply_type="answer", text="Final answer after 8 tool calls [P1]")
    messages.append(
        AIMessage(
            content="",
            tool_calls=[{"name": "ChatReply", "args": forced_reply.model_dump(), "id": "call_9"}],
        )
    )

    model = ScriptedChatModel(messages=iter(messages))

    def fake_role_models(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    conn = connect(container.db_path)
    try:
        rec_id = seed_recording(conn, kind="meeting", title="Sync")
        seed_chunk(
            conn,
            rec_id,
            first_idx=0,
            last_idx=0,
            text="Sync text",
            vector=container.embedder.embed_query("search 1"),
        )
    finally:
        conn.close()

    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph = build_chat_graph(container)

    final_state: dict[str, Any] = {}

    async def run() -> None:
        nonlocal final_state
        stream = cast(Any, graph).astream(
            {"messages": [HumanMessage(content="Keep searching")]},
            context=ctx,
            stream_mode=["custom", "values"],
            subgraphs=True,
        )
        async for chunk in stream:
            namespace, mode, payload = chunk
            if namespace == () and mode == "values" and isinstance(payload, dict):
                final_state = cast(dict[str, Any], payload)

    asyncio.run(run())

    # On call 9 (the 9th model invocation), bound tools must be exactly ChatReply and tool_choice == "any"
    assert len(model.bindings) >= 9
    call_9_binding = model.bindings[8]
    assert call_9_binding["tool_names"] == ["ChatReply"]
    assert call_9_binding["tool_choice"] == "any"

    final = final_state.get("final")
    assert isinstance(final, FinalReply)
    assert final.reply_type == "answer"


def test_model_call_limit_ends_at_ten_calls(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    # Model produces tool calls on each turn; run_limit=10 stops it after 10 calls
    messages = [
        AIMessage(
            content="",
            tool_calls=[{"name": "search_transcripts", "args": {"query": f"q{i}"}, "id": f"call_{i}"}],
        )
        for i in range(1, 15)
    ]
    model = ScriptedChatModel(messages=iter(messages))

    def fake_role_models(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph = build_chat_graph(container)

    final_state: dict[str, Any] = {}

    async def run() -> None:
        nonlocal final_state
        stream = cast(Any, graph).astream(
            {"messages": [HumanMessage(content="Hello")]},
            context=ctx,
            stream_mode=["values"],
            subgraphs=True,
        )
        async for chunk in stream:
            namespace, mode, payload = chunk
            if namespace == () and mode == "values" and isinstance(payload, dict):
                final_state = cast(dict[str, Any], payload)

    asyncio.run(run())
    assert len(model.bindings) == 10
    messages = final_state.get("messages", [])
    assert any("limit" in str(m.content).lower() for m in messages)


def test_tool_call_limit_refuses_eighth_call(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    tool_calls = [{"name": "search_transcripts", "args": {"query": f"q{i}"}, "id": f"call_{i}"} for i in range(1, 9)]
    messages = [
        AIMessage(content="", tool_calls=tool_calls),
        AIMessage(
            content="",
            tool_calls=[
                {"name": "ChatReply", "args": {"reply_type": "answer", "text": "Done [P1]"}, "id": "call_final"}
            ],
        ),
    ]
    model = ScriptedChatModel(messages=iter(messages))

    def fake_role_models(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    conn = connect(container.db_path)
    try:
        rec_id = seed_recording(conn, kind="meeting", title="Sync")
        seed_chunk(
            conn,
            rec_id,
            first_idx=0,
            last_idx=0,
            text="Sync text",
            vector=container.embedder.embed_query("q1"),
        )
    finally:
        conn.close()

    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph = build_chat_graph(container)

    final_state: dict[str, Any] = {}

    async def run() -> None:
        nonlocal final_state
        stream = cast(Any, graph).astream(
            {"messages": [HumanMessage(content="Search many")]},
            context=ctx,
            stream_mode=["values"],
            subgraphs=True,
        )
        async for chunk in stream:
            namespace, mode, payload = chunk
            if namespace == () and mode == "values" and isinstance(payload, dict):
                final_state = cast(dict[str, Any], payload)

    asyncio.run(run())
    messages = final_state.get("messages", [])
    tool_messages = [m for m in messages if getattr(m, "type", None) == "tool"]
    call_8_msg = next((m for m in tool_messages if getattr(m, "tool_call_id", None) == "call_8"), None)
    assert call_8_msg is not None
    assert "Tool call limit exceeded" in str(call_8_msg.content)
    call_1_msg = next((m for m in tool_messages if getattr(m, "tool_call_id", None) == "call_1"), None)
    assert call_1_msg is not None
    assert "Tool call limit exceeded" not in str(call_1_msg.content)


def test_graph_answer_with_citations(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = connect(container.db_path)
    try:
        v_sync = container.embedder.embed_query("sync")
        rec_id = seed_recording(conn, kind="meeting", title="Sync Meeting")
        seed_chunk(conn, rec_id, first_idx=0, last_idx=0, text="Speaker A: sync details", vector=v_sync)
        row = conn.execute("SELECT id FROM segments WHERE recording_id = ? AND idx = 0", (rec_id,)).fetchone()
        assert row is not None
        seg_id = str(row[0])
    finally:
        conn.close()

    reply = ChatReply(reply_type="answer", text="Found the sync details [P1].")
    model = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "search_transcripts", "args": {"query": "sync"}, "id": "call_1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatReply", "args": reply.model_dump(), "id": "call_2"}],
                ),
            ]
        )
    )

    def fake_role_models(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph = build_chat_graph(container)

    final_state: dict[str, Any] = {}

    async def run() -> None:
        nonlocal final_state
        stream = cast(Any, graph).astream(
            {"messages": [HumanMessage(content="What are the sync details?")]},
            context=ctx,
            stream_mode=["custom", "values"],
            subgraphs=True,
        )
        async for chunk in stream:
            namespace, mode, payload = chunk
            if namespace == () and mode == "values" and isinstance(payload, dict):
                final_state = cast(dict[str, Any], payload)

    asyncio.run(run())

    final = final_state.get("final")
    assert isinstance(final, FinalReply)
    assert final.reply_type == "answer"
    assert "[1]" in final.text
    assert len(final.citations) == 1
    assert final.citations[0].n == 1
    assert final.citations[0].recording_id == rec_id
    assert final.citations[0].segment_id == seg_id


def test_graph_citing_unknown_label_is_not_found(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    reply = ChatReply(reply_type="answer", text="Invented fact [P99].")
    model = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatReply", "args": reply.model_dump(), "id": "call_1"}],
                ),
            ]
        )
    )

    def fake_role_models(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph = build_chat_graph(container)

    final_state: dict[str, Any] = {}

    async def run() -> None:
        nonlocal final_state
        stream = cast(Any, graph).astream(
            {"messages": [HumanMessage(content="What about X?")]},
            context=ctx,
            stream_mode=["custom", "values"],
            subgraphs=True,
        )
        async for chunk in stream:
            namespace, mode, payload = chunk
            if namespace == () and mode == "values" and isinstance(payload, dict):
                final_state = cast(dict[str, Any], payload)

    asyncio.run(run())

    final = final_state.get("final")
    assert isinstance(final, FinalReply)
    assert final.reply_type == "answer"
    assert final.text == NOT_FOUND
    assert final.citations == []
