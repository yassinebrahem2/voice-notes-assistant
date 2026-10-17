"""Tests for chat runs lifecycle and API endpoints."""

import asyncio
import time
from collections.abc import Sequence
from typing import Any, Self

import httpx2 as httpx
import openai
import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.agents.chat_graph import build_chat_graph
from app.agents.citations import FinalReply
from app.agents.schemas import ChatReply
from app.api.app import create_app
from app.api.models.chats import CitationOut
from app.chats.runs import ChatRuns
from app.chats.store import add_assistant_message, add_user_message, create_chat
from app.container import Container
from app.db.connection import connect
from tests.agents.fake_models import FailingChatModel, ScriptedChatModel
from tests.seed import seed_chunk, seed_recording


class SleepingChatModel(BaseChatModel):
    delay: float = 1.0

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        time.sleep(self.delay)
        return ChatResult(generations=[])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        await asyncio.sleep(self.delay)
        return ChatResult(generations=[])

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> Self:
        return self

    @property
    def _llm_type(self) -> str:
        return "sleeping-chat-model"


class CancellableSlowChatModel(BaseChatModel):
    delay: float = 10.0
    was_cancelled: bool = False

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        time.sleep(self.delay)
        return ChatResult(generations=[])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        try:
            await asyncio.sleep(self.delay)
        except asyncio.CancelledError:
            self.was_cancelled = True
            raise
        return ChatResult(generations=[])

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> Self:
        return self

    @property
    def _llm_type(self) -> str:
        return "cancellable-slow-chat-model"


class SlowScriptedModel(BaseChatModel):
    delay: float = 0.5
    messages: list[AIMessage]

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        time.sleep(self.delay)
        msg = self.messages.pop(0) if self.messages else AIMessage(content="Done")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        await asyncio.sleep(self.delay)
        msg = self.messages.pop(0) if self.messages else AIMessage(content="Done")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> Self:
        return self

    @property
    def _llm_type(self) -> str:
        return "slow-scripted-model"


def test_ask_then_poll_done_with_steps_and_citations(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = connect(container.db_path)
    try:
        rec_id = seed_recording(conn, kind="meeting", title="Roadmap Sync")
        seed_chunk(
            conn,
            rec_id,
            first_idx=0,
            last_idx=0,
            text="We decided to launch next Friday.",
            vector=container.embedder.embed_query("launch"),
        )
    finally:
        conn.close()

    reply = ChatReply(reply_type="answer", text="We decided to launch next Friday [P1].")
    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "search_transcripts", "args": {"query": "launch"}, "id": "call_1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatReply", "args": reply.model_dump(), "id": "call_2"}],
                ),
            ]
        )
    )

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [scripted]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        assert create_res.status_code == 201
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "When is launch?", "scope": "both"},
        )
        assert ask_res.status_code == 202
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "done":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "done"
        steps: list[str] = run_data["steps"]
        assert any("Searching" in s for s in steps)
        assert any("Found 1 passages" in s for s in steps)
        assert any("Writing answer…" in s for s in steps)

        msg: dict[str, Any] | None = run_data["message"]
        assert msg is not None
        assert msg["reply_type"] == "answer"
        assert "[1]" in msg["text"]
        assert len(msg["citations"]) == 1
        assert msg["citations"][0]["recording_title"] == "Roadmap Sync"


def test_all_models_fail_run_failed_ai_unavailable(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    err_429 = openai.RateLimitError(
        message="429 Rate Limit",
        response=httpx.Response(429, request=req),
        body=None,
    )
    failing = FailingChatModel(error=err_429)

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [failing]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello?", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "failed":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "failed"
        assert run_data["error"] == {
            "code": "ai_unavailable",
            "message": "Couldn't reach the AI right now.",
        }


def test_model_error_run_failed_ai_unavailable(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    from langchain_core.exceptions import ModelRateLimitError

    failing = FailingChatModel(error=ModelRateLimitError("429 Resource exhausted"))

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [failing]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello?", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "failed":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "failed"
        assert run_data["error"] == {
            "code": "ai_unavailable",
            "message": "Couldn't reach the AI right now.",
        }


def test_httpx_timeout_run_failed_ai_unavailable(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx as real_httpx

    failing = FailingChatModel(error=real_httpx.ReadTimeout("Read timed out"))

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [failing]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello?", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "failed":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "failed"
        assert run_data["error"] == {
            "code": "ai_unavailable",
            "message": "Couldn't reach the AI right now.",
        }


def test_tool_bug_is_internal_error_not_ai_unavailable(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    def buggy_search(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("Disk corruption error")

    monkeypatch.setattr("app.agents.tools.search_chunks", buggy_search)

    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "search_transcripts", "args": {"query": "crash"}, "id": "call_crash"}],
                )
            ]
        )
    )

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [scripted]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Cause tool bug", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "failed":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "failed"
        assert run_data["error"] == {
            "code": "internal_error",
            "message": "Internal error",
        }


def test_deadline_times_out(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(container.settings, "chat_deadline_s", 0.2)

    sleeping = SleepingChatModel(delay=1.0)

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [sleeping]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Wait forever", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "failed":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "failed"
        assert run_data["error"] == {
            "code": "timed_out",
            "message": "That took too long.",
        }


def test_deadline_times_out_and_cancels_model(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(container.settings, "chat_deadline_s", 0.2)

    model = CancellableSlowChatModel(delay=10.0)

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Wait forever", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "failed":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "failed"
        assert run_data["error"] == {
            "code": "timed_out",
            "message": "That took too long.",
        }
        assert model.was_cancelled is True


def test_unknown_run_404_then_retry_reuses_message(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    reply = ChatReply(reply_type="help", text="Here is help.")

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        scripted = ScriptedChatModel(
            messages=iter(
                [
                    AIMessage(
                        content="",
                        tool_calls=[{"name": "ChatReply", "args": reply.model_dump(), "id": "call_help"}],
                    )
                ]
            )
        )
        return [scripted]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Help me", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        # Simulate server restart clearing in-memory runs
        container.chat_runs = ChatRuns(container, build_chat_graph)

        get_res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
        assert get_res.status_code == 404
        assert get_res.json()["error"]["code"] == "not_found"

        retry_res = client.post(f"/api/v1/chats/{chat_id}/runs/{run_id}/retry")
        assert retry_res.status_code == 202
        assert retry_res.json()["run_id"] == run_id

        conn = connect(container.db_path)
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM messages WHERE chat_id = ? AND role = 'user'",
                (chat_id,),
            ).fetchone()[0]
            assert count == 1
        finally:
            conn.close()

        run_data: dict[str, Any] | None = None
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            assert res.status_code == 200
            data: dict[str, Any] = res.json()
            if data["status"] == "done":
                run_data = data
                break
            time.sleep(0.05)

        assert isinstance(run_data, dict)
        assert run_data["status"] == "done"


def test_retry_unknown_run_with_stored_reply_returns_it(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = connect(container.db_path)
    try:
        chat = create_chat(conn)
        from app.api.models.chats import AskIn

        run_id = add_user_message(conn, chat.id, AskIn(text="What was decided?", scope="both"))
        add_assistant_message(
            conn,
            chat.id,
            FinalReply(
                reply_type="answer",
                text="Already answered [1].",
                citations=[
                    CitationOut(
                        n=1,
                        recording_id="rec_1",
                        segment_id="seg_1",
                        start_ms=0,
                        recording_title="Meeting",
                    )
                ],
            ),
        )
        assistant_count_before = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE chat_id = ? AND role = 'assistant'",
            (chat.id,),
        ).fetchone()[0]
        assert assistant_count_before == 1
    finally:
        conn.close()

    # Simulate server restart clearing in-memory runs
    container.chat_runs = ChatRuns(container, build_chat_graph)

    def forbidden_graph(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Graph must not be invoked when assistant reply is already stored")

    monkeypatch.setattr(container.chat_runs, "_get_graph", forbidden_graph)

    with TestClient(create_app(container)) as client:
        retry_res = client.post(f"/api/v1/chats/{chat.id}/runs/{run_id}/retry")
        assert retry_res.status_code == 202
        assert retry_res.json()["run_id"] == run_id

        get_res = client.get(f"/api/v1/chats/{chat.id}/runs/{run_id}")
        assert get_res.status_code == 200
        run_data = get_res.json()
        assert run_data["status"] == "done"
        assert run_data["message"]["text"] == "Already answered [1]."

    conn = connect(container.db_path)
    try:
        assistant_count_after = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE chat_id = ? AND role = 'assistant'",
            (chat.id,),
        ).fetchone()[0]
        assert assistant_count_after == 1
    finally:
        conn.close()


def test_retry_while_running_409(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    reply = ChatReply(reply_type="help", text="Help answer")
    slow_model = SlowScriptedModel(
        delay=0.5,
        messages=[
            AIMessage(
                content="",
                tool_calls=[{"name": "ChatReply", "args": reply.model_dump(), "id": "call_slow"}],
            )
        ],
    )

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [slow_model]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Slow question", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        # Retry while running -> 409
        retry_running = client.post(f"/api/v1/chats/{chat_id}/runs/{run_id}/retry")
        assert retry_running.status_code == 409
        assert retry_running.json()["error"]["code"] == "not_failed"

        # Wait until done
        for _ in range(100):
            res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
            if res.json()["status"] == "done":
                break
            time.sleep(0.05)

        # Retry when done -> 409
        retry_done = client.post(f"/api/v1/chats/{chat_id}/runs/{run_id}/retry")
        assert retry_done.status_code == 409
        assert retry_done.json()["error"]["code"] == "not_failed"


def test_run_scoping_different_chat_id_returns_404_on_get_and_retry(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    reply = ChatReply(reply_type="answer", text="Answer")
    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ChatReply", "args": reply.model_dump(), "id": "call_scoping"}],
                ),
            ]
        )
    )

    def fake_role_models(_reg: object, _role: object) -> list[BaseChatModel]:
        return [scripted]

    monkeypatch.setattr("app.llm.factory.role_models", fake_role_models)

    with TestClient(create_app(container)) as client:
        # Create chat 1 and start a run
        res1 = client.post("/api/v1/chats")
        assert res1.status_code == 201
        chat_id_1 = res1.json()["id"]

        # Create chat 2
        res2 = client.post("/api/v1/chats")
        assert res2.status_code == 201
        chat_id_2 = res2.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id_1}/messages",
            json={"text": "Question for chat 1", "scope": "both"},
        )
        assert ask_res.status_code == 202
        run_id = ask_res.json()["run_id"]

        # GET on chat_id_2 with run_id from chat_id_1 must return 404
        get_res = client.get(f"/api/v1/chats/{chat_id_2}/runs/{run_id}")
        assert get_res.status_code == 404
        assert get_res.json()["error"]["code"] == "not_found"
        assert get_res.json()["error"]["message"] == "Run not found"

        # POST retry on chat_id_2 with run_id from chat_id_1 must return 404
        retry_res = client.post(f"/api/v1/chats/{chat_id_2}/runs/{run_id}/retry")
        assert retry_res.status_code == 404
        assert retry_res.json()["error"]["code"] == "not_found"
        assert retry_res.json()["error"]["message"] == "Run not found"


def test_chat_runs_max_finished_runs_drops_oldest_finished_keeps_running(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.chats.runs import MAX_FINISHED_RUNS, RunState

    chat_runs = ChatRuns(container, build_chat_graph)
    container.chat_runs = chat_runs

    # Start a running run directly in state
    chat_runs.runs["running_run"] = RunState(chat_id="chat_1", status="running", steps=[])

    # Record 101 finished runs
    for i in range(MAX_FINISHED_RUNS + 1):
        r_id = f"finished_{i}"
        chat_runs.runs[r_id] = RunState(chat_id="chat_1", status="done", steps=[])
        chat_runs.record_finished(r_id)

    # Oldest finished run (finished_0) should have been dropped
    assert chat_runs.get("finished_0") is None
    # Subsequent finished runs should still be present
    assert chat_runs.get("finished_1") is not None
    assert chat_runs.get(f"finished_{MAX_FINISHED_RUNS}") is not None
    # The running run must still be present
    running_state = chat_runs.get("running_run")
    assert running_state is not None
    assert running_state.status == "running"
