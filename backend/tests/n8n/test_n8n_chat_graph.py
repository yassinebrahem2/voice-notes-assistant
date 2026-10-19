import asyncio
import json
import time
from typing import Any, cast

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agents.citations import NOT_FOUND, FinalReply
from app.api.app import create_app
from app.api.models.chats import AskIn
from app.chats.store import add_assistant_message, add_user_message, create_chat
from app.container import Container
from app.db.connection import connect
from app.n8n.runs import lookup
from tests.n8n.conftest import UNIT_VECTOR_768, N8nMockDispatcher
from tests.seed import seed_chunk, seed_recording


def _poll_run(client: TestClient, chat_id: str, run_id: str, max_attempts: int = 100) -> dict[str, Any]:
    for _ in range(max_attempts):
        res = client.get(f"/api/v1/chats/{chat_id}/runs/{run_id}")
        assert res.status_code == 200
        data = cast(dict[str, Any], res.json())
        if data["status"] in ("done", "failed"):
            return data
        time.sleep(0.05)
    pytest.fail(f"Run {run_id} did not complete within timeout")


def test_n8n_chat_answer_cites_registered_source(
    n8n_container: Container,
    n8n_mock: N8nMockDispatcher,
) -> None:
    conn = connect(n8n_container.db_path)
    try:
        rec_id = seed_recording(conn, kind="meeting", title="Budget Sync")
        seed_chunk(
            conn,
            rec_id,
            first_idx=0,
            last_idx=0,
            text="The budgetsync discussion happened here.",
            vector=UNIT_VECTOR_768,
        )
    finally:
        conn.close()

    app = create_app(n8n_container)

    async def chat_handler(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content.decode("utf-8"))
        run_id = data["run_id"]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
            tool_resp = await ac.post(
                "/internal/n8n/tools/search_transcripts",
                headers={"X-N8N-Secret": "test-secret"},
                json={"run_id": run_id, "query": "budgetsync", "k": 8},
            )
            assert tool_resp.status_code == 200
            res_data = tool_resp.json()
            assert "[P1]" in res_data["result"]
        return httpx.Response(200, json={"output": {"reply_type": "answer", "text": "Here is the info [P1]."}})

    n8n_mock.chat_handler = chat_handler

    with TestClient(app) as client:
        create_res = client.post("/api/v1/chats")
        assert create_res.status_code == 201
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "budgetsync", "scope": "both"},
        )
        assert ask_res.status_code == 202
        run_id = ask_res.json()["run_id"]

        run_data = _poll_run(client, chat_id, run_id)
        assert run_data["status"] == "done"
        steps: list[str] = run_data["steps"]
        assert "Writing answer…" in steps
        assert not any("n8n" in s.lower() for s in steps)

        msg = run_data["message"]
        assert msg is not None
        assert msg["text"] == "Here is the info [1]."
        citations: list[dict[str, Any]] = msg["citations"]
        assert len(citations) == 1
        assert citations[0]["recording_id"] == rec_id
        assert citations[0]["recording_title"] == "Budget Sync"


def test_unknown_label_rejected(
    n8n_container: Container,
    n8n_mock: N8nMockDispatcher,
) -> None:
    app = create_app(n8n_container)

    def chat_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"output": {"reply_type": "answer", "text": "Here is something [P9]."}},
        )

    n8n_mock.chat_handler = chat_handler

    with TestClient(app) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data = _poll_run(client, chat_id, run_id)
        assert run_data["status"] == "done"
        msg = run_data["message"]
        assert msg is not None
        assert msg["text"] == NOT_FOUND
        assert msg["citations"] == []


def test_prompt_renders_history(
    n8n_container: Container,
    n8n_mock: N8nMockDispatcher,
) -> None:
    conn = connect(n8n_container.db_path)
    try:
        chat = create_chat(conn)
        chat_id = chat.id
        add_user_message(conn, chat_id, AskIn(text="First turn question", scope="both"))
        add_assistant_message(
            conn,
            chat_id,
            FinalReply(reply_type="answer", text="First turn answer", citations=[]),
        )
    finally:
        conn.close()

    app = create_app(n8n_container)
    captured_payload: dict[str, Any] = {}

    def chat_handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={"output": {"reply_type": "answer", "text": "Second answer."}},
        )

    n8n_mock.chat_handler = chat_handler

    with TestClient(app) as client:
        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Second turn question", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]
        run_data = _poll_run(client, chat_id, run_id)
        assert run_data["status"] == "done"

    prompt = cast(str, captured_payload.get("prompt", ""))
    assert "User: First turn question" in prompt
    assert "Assistant: First turn answer" in prompt
    assert "User: Second turn question" in prompt
    assert prompt.endswith("User: Second turn question")

    system_prompt = cast(str, captured_payload.get("system_prompt", ""))
    assert "Today's date:" in system_prompt
    assert "Scope: both" in system_prompt
    assert system_prompt.strip().endswith("Scope: both")


def test_n8n_down_is_ai_unavailable(
    n8n_container: Container,
    n8n_mock: N8nMockDispatcher,
) -> None:
    app = create_app(n8n_container)

    def chat_handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused")

    n8n_mock.chat_handler = chat_handler

    with TestClient(app) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data = _poll_run(client, chat_id, run_id)
        assert run_data["status"] == "failed"
        assert run_data["error"] is not None
        assert run_data["error"]["code"] == "ai_unavailable"
        assert run_data["error"]["message"] == "Couldn't reach the AI right now."


def test_slow_n8n_hits_deadline(
    n8n_container: Container,
    n8n_mock: N8nMockDispatcher,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(n8n_container.settings, "chat_deadline_s", 0.2)
    app = create_app(n8n_container)

    async def chat_handler(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1.0)
        return httpx.Response(
            200,
            json={"output": {"reply_type": "answer", "text": "Finally done"}},
        )

    n8n_mock.chat_handler = chat_handler

    with TestClient(app) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data = _poll_run(client, chat_id, run_id)
        assert run_data["status"] == "failed"
        assert run_data["error"] is not None
        assert run_data["error"]["code"] == "timed_out"
        assert run_data["error"]["message"] == "That took too long."


def test_run_unregistered_after_finish(
    n8n_container: Container,
    n8n_mock: N8nMockDispatcher,
) -> None:
    app = create_app(n8n_container)
    captured_run_id: str | None = None

    def chat_handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_run_id
        data = cast(dict[str, Any], json.loads(request.content.decode("utf-8")))
        run_id_val = cast(str, data["run_id"])
        captured_run_id = run_id_val
        # Inside the run, it must be registered
        assert lookup(run_id_val) is not None
        return httpx.Response(
            200,
            json={"output": {"reply_type": "answer", "text": "Done."}},
        )

    n8n_mock.chat_handler = chat_handler

    with TestClient(app) as client:
        create_res = client.post("/api/v1/chats")
        chat_id = create_res.json()["id"]

        ask_res = client.post(
            f"/api/v1/chats/{chat_id}/messages",
            json={"text": "Hello", "scope": "both"},
        )
        run_id = ask_res.json()["run_id"]

        run_data = _poll_run(client, chat_id, run_id)
        assert run_data["status"] == "done"

    assert captured_run_id is not None
    # After the run finishes, it must be unregistered
    assert lookup(captured_run_id) is None
