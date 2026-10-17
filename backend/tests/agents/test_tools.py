import asyncio
from datetime import date
from typing import Any, cast

import pytest
from langchain.tools import ToolRuntime
from langchain_core.messages import AIMessage, HumanMessage

from app.agents.chat_context import ChatContext
from app.agents.chat_graph import build_chat_graph
from app.agents.schemas import ChatReply, ChatSummary, ChatSummaryItem
from app.agents.sources import SourceRegistry
from app.agents.tools import find_recordings, summarize
from app.container import Container
from app.db.connection import connect
from app.domain.analysis import AnalysisActionItem, AnalysisItem, MeetingSummary
from app.rag.retrieve import Hit
from tests.agents.fake_models import ScriptedChatModel
from tests.seed import seed_chunk, seed_recording


def test_search_tool_scope_and_status_lines(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = connect(container.db_path)
    try:
        v_sync = container.embedder.embed_query("sync")
        rec_meeting = seed_recording(
            conn,
            kind="meeting",
            title="Weekly sync",
            segments=[(0, 3000, "A", "Weekly sync discussion")],
        )
        seed_chunk(conn, rec_meeting, first_idx=0, last_idx=0, text="Speaker A: Weekly sync discussion", vector=v_sync)

        v_note = container.embedder.embed_query("note")
        rec_note = seed_recording(
            conn,
            kind="note",
            title="Architecture note",
            segments=[(0, 3000, None, "Architecture note text")],
        )
        seed_chunk(conn, rec_note, first_idx=0, last_idx=0, text="Architecture note text", vector=v_note)
    finally:
        conn.close()

    # Scope: meetings
    reply_meeting = ChatReply(reply_type="answer", text="Found sync info [P1]")
    model_meeting = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "search_transcripts", "args": {"query": "sync"}, "id": "call_1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatReply", "args": reply_meeting.model_dump(), "id": "call_2"}],
                ),
            ]
        )
    )

    def fake_models_meeting(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model_meeting]

    monkeypatch.setattr("app.llm.factory.role_models", fake_models_meeting)

    ctx_meetings = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="meetings",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph = build_chat_graph(container)

    events_meeting: list[tuple[tuple[str, ...], str, object]] = []

    async def run_meetings() -> None:
        stream = cast(Any, graph).astream(
            {"messages": [HumanMessage(content="What happened in the sync?")]},
            context=ctx_meetings,
            stream_mode=["custom", "values"],
            subgraphs=True,
        )
        async for chunk in stream:
            events_meeting.append(chunk)

    asyncio.run(run_meetings())

    custom_meeting_steps = [payload for _, mode, payload in events_meeting if mode == "custom"]
    assert "Searching meetings…" in custom_meeting_steps
    assert "Found 1 passages" in custom_meeting_steps

    # Scope: notes (searching "sync" matches 0 notes)
    reply_notes = ChatReply(reply_type="answer", text=None)
    model_notes = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "search_transcripts", "args": {"query": "sync"}, "id": "call_3"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatReply", "args": reply_notes.model_dump(), "id": "call_4"}],
                ),
            ]
        )
    )

    def fake_models_notes(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [model_notes]

    monkeypatch.setattr("app.llm.factory.role_models", fake_models_notes)

    ctx_notes = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="notes",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=SourceRegistry(),
    )

    graph_notes = build_chat_graph(container)
    events_notes: list[tuple[tuple[str, ...], str, object]] = []

    async def run_notes() -> None:
        stream = cast(Any, graph_notes).astream(
            {"messages": [HumanMessage(content="What happened in the sync?")]},
            context=ctx_notes,
            stream_mode=["custom", "values"],
            subgraphs=True,
        )
        async for chunk in stream:
            events_notes.append(chunk)

    asyncio.run(run_notes())

    custom_notes_steps = [payload for _, mode, payload in events_notes if mode == "custom"]
    assert "Searching notes…" in custom_notes_steps
    assert "Found 0 passages" in custom_notes_steps


def test_summarize_one_recording_no_model_call(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = connect(container.db_path)
    try:
        meeting = MeetingSummary(
            overview="Discussion on deployment.",
            decisions=[AnalysisItem(text="Deploy on Friday.", citations=[])],
            action_items=[
                AnalysisActionItem(
                    text="Prepare release notes.",
                    citations=[],
                    owner_speaker_id="spk_1",
                    due="Thursday",
                )
            ],
            open_questions=[AnalysisItem(text="Who tests staging?", citations=[])],
        )
        rec_id = seed_recording(conn, kind="meeting", title="Release Sync", analysis=meeting)
    finally:
        conn.close()

    model_called = False

    def fake_role_models(_reg: object, _role: object) -> list[object]:
        nonlocal model_called
        model_called = True
        return []

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    registry = SourceRegistry()
    r1 = registry.add_recording({"recording_id": rec_id, "title": "Release Sync", "start_ms": 0})

    steps: list[str] = []
    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=registry,
    )

    runtime: ToolRuntime[ChatContext, dict[str, Any]] = ToolRuntime(
        state={"messages": []},
        context=ctx,
        config={},
        stream_writer=steps.append,
        tool_call_id="call_test",
        store=None,
    )

    summarize_fn = cast(Any, summarize).func
    result = str(summarize_fn(sources=[r1], runtime=runtime))

    assert model_called is False
    assert "Summarizing 1 recording…" in steps
    assert "<sources>" in result
    assert "Deploy on Friday." in result
    assert "Prepare release notes." in result
    # Check that items were registered as passages in registry
    assert registry.resolve("P1") is not None


def test_summarize_accepts_p_label(container: Container) -> None:
    conn = connect(container.db_path)
    try:
        meeting = MeetingSummary(
            overview="Sprint planning.",
            decisions=[AnalysisItem(text="Pick tickets 1-5.", citations=[])],
            action_items=[],
            open_questions=[],
        )
        rec_id = seed_recording(conn, kind="meeting", title="Planning", analysis=meeting)
    finally:
        conn.close()

    registry = SourceRegistry()
    hit = Hit(
        recording_id=rec_id,
        recording_title="Planning",
        kind="meeting",
        created_at="2026-10-17T00:00:00Z",
        first_segment_id="seg_1",
        start_ms=0,
        end_ms=3000,
        text="Planning snippet",
        distance=0.1,
    )
    p1 = registry.add_passage(hit)

    steps: list[str] = []
    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=registry,
    )
    runtime: ToolRuntime[ChatContext, dict[str, Any]] = ToolRuntime(
        state={"messages": []},
        context=ctx,
        config={},
        stream_writer=steps.append,
        tool_call_id="call_test",
        store=None,
    )

    summarize_fn = cast(Any, summarize).func
    result = str(summarize_fn(sources=[p1], runtime=runtime))
    assert "<sources>" in result
    assert "Pick tickets 1-5." in result


def test_summarize_not_ready(container: Container) -> None:
    conn = connect(container.db_path)
    try:
        rec_id = seed_recording(conn, kind="meeting", status="transcribing", title="WIP")
    finally:
        conn.close()

    registry = SourceRegistry()
    r1 = registry.add_recording({"recording_id": rec_id, "title": "WIP", "start_ms": 0})

    steps: list[str] = []
    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=registry,
    )
    runtime: ToolRuntime[ChatContext, dict[str, Any]] = ToolRuntime(
        state={"messages": []},
        context=ctx,
        config={},
        stream_writer=steps.append,
        tool_call_id="call_test",
        store=None,
    )

    summarize_fn = cast(Any, summarize).func
    result = str(summarize_fn(sources=[r1], runtime=runtime))
    assert "not ready yet" in result.lower()


def test_summarize_several_drops_unknown_labels(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = connect(container.db_path)
    try:
        m1 = MeetingSummary(
            overview="Sync 1",
            decisions=[AnalysisItem(text="Decision 1", citations=[])],
            action_items=[],
            open_questions=[],
        )
        rec1 = seed_recording(conn, kind="meeting", title="Sync 1", analysis=m1)

        m2 = MeetingSummary(
            overview="Sync 2",
            decisions=[AnalysisItem(text="Decision 2", citations=[])],
            action_items=[],
            open_questions=[],
        )
        rec2 = seed_recording(conn, kind="meeting", title="Sync 2", analysis=m2)
    finally:
        conn.close()

    registry = SourceRegistry()
    r1 = registry.add_recording({"recording_id": rec1, "title": "Sync 1", "start_ms": 0})
    r2 = registry.add_recording({"recording_id": rec2, "title": "Sync 2", "start_ms": 0})

    # Model returns ChatSummary with a decision citing [r1, "R99"] and another citing only ["R99"]
    merged_summary = ChatSummary(
        overview="Merged syncs",
        decisions=[
            ChatSummaryItem(text="Valid decision", sources=[r1, "R99"]),
            ChatSummaryItem(text="Invalid decision", sources=["R99"]),
        ],
        action_items=[],
        open_questions=[],
    )

    scripted_model = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatSummary", "args": merged_summary.model_dump(), "id": "call_merge"}],
                )
            ]
        )
    )

    def fake_role_models(_reg: object, _role: object) -> list[ScriptedChatModel]:
        return [scripted_model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    steps: list[str] = []
    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=registry,
    )
    runtime: ToolRuntime[ChatContext, dict[str, Any]] = ToolRuntime(
        state={"messages": []},
        context=ctx,
        config={},
        stream_writer=steps.append,
        tool_call_id="call_test",
        store=None,
    )

    summarize_fn = cast(Any, summarize).func
    result = str(summarize_fn(sources=[r1, r2], runtime=runtime))
    assert "Summarizing 2 recordings…" in steps
    assert "Valid decision" in result
    assert "Invalid decision" not in result
    assert "R99" not in result


def test_find_recordings_filters_and_formats(container: Container) -> None:
    conn = connect(container.db_path)
    try:
        meeting = MeetingSummary(
            overview="Discussion on infra.",
            decisions=[],
            action_items=[],
            open_questions=[],
        )
        seed_recording(
            conn,
            kind="meeting",
            title="Infra Sync",
            tags=["infra", "devops"],
            analysis=meeting,
            created_at="2026-10-17T10:00:00Z",
        )
    finally:
        conn.close()

    registry = SourceRegistry()
    steps: list[str] = []
    ctx = ChatContext(
        db_path=container.db_path,
        embedder=container.embedder,
        settings=container.settings,
        models=container.models,
        scope="both",
        tag_ids=[],
        today=date(2026, 10, 17),
        sources=registry,
    )
    runtime: ToolRuntime[ChatContext, dict[str, Any]] = ToolRuntime(
        state={"messages": []},
        context=ctx,
        config={},
        stream_writer=steps.append,
        tool_call_id="call_test",
        store=None,
    )

    find_fn = cast(Any, find_recordings).func
    result = str(find_fn(text="Infra", runtime=runtime))
    assert "Looking up recordings…" in steps
    assert "<sources>" in result
    assert "[R1] Infra Sync · 2026-10-17" in result
    assert "devops, infra" in result
    assert "Discussion on infra." in result
    assert registry.resolve("R1") is not None
