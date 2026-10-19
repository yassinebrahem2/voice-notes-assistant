from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agents.chat_context import ChatContext
from app.agents.sources import SourceRegistry
from app.api.app import create_app
from app.container import Container
from app.db.connection import connect
from app.domain.analysis import MeetingSummary
from app.n8n.runs import register, unregister
from tests.n8n.conftest import UNIT_VECTOR_768
from tests.seed import seed_chunk, seed_recording


@pytest.fixture
def test_app(n8n_container: Container) -> Any:
    return create_app(n8n_container)


def test_missing_secret_returns_401(test_app: Any) -> None:
    with TestClient(test_app) as client:
        res = client.post(
            "/internal/n8n/tools/search_transcripts",
            json={"run_id": "dummy", "query": "test"},
        )
        assert res.status_code == 401


def test_wrong_secret_returns_401(test_app: Any) -> None:
    with TestClient(test_app) as client:
        res = client.post(
            "/internal/n8n/tools/search_transcripts",
            headers={"X-N8N-Secret": "wrong-secret"},
            json={"run_id": "dummy", "query": "test"},
        )
        assert res.status_code == 401


def test_unknown_run_id_returns_404(test_app: Any) -> None:
    with TestClient(test_app) as client:
        res = client.post(
            "/internal/n8n/tools/search_transcripts",
            headers={"X-N8N-Secret": "test-secret"},
            json={"run_id": "nonexistent_run", "query": "test"},
        )
        assert res.status_code == 404


def test_search_transcripts_with_registered_context(test_app: Any, n8n_container: Container) -> None:
    conn = connect(n8n_container.db_path)
    try:
        rec_id = seed_recording(conn, kind="meeting", title="Budget Sync")
        seed_chunk(
            conn,
            rec_id,
            first_idx=0,
            last_idx=0,
            text="Let's review the budget sync results.",
            vector=UNIT_VECTOR_768,
        )
    finally:
        conn.close()

    ctx = ChatContext(
        db_path=n8n_container.db_path,
        embedder=n8n_container.embedder,
        settings=n8n_container.settings,
        models=n8n_container.models,
        scope="both",
        tag_ids=[],
        today=date.today(),
        sources=SourceRegistry(),
    )
    run_id = register(ctx)
    try:
        with TestClient(test_app) as client:
            res = client.post(
                "/internal/n8n/tools/search_transcripts",
                headers={"X-N8N-Secret": "test-secret"},
                json={"run_id": run_id, "query": "budget"},
            )
            assert res.status_code == 200
            data = res.json()
            assert "result" in data
            assert "<sources>" in data["result"]
            assert "[P1]" in data["result"]
    finally:
        unregister(run_id)


def test_find_recordings_with_registered_context(test_app: Any, n8n_container: Container) -> None:
    conn = connect(n8n_container.db_path)
    try:
        seed_recording(conn, kind="meeting", title="All Hands Roadmap")
    finally:
        conn.close()

    ctx = ChatContext(
        db_path=n8n_container.db_path,
        embedder=n8n_container.embedder,
        settings=n8n_container.settings,
        models=n8n_container.models,
        scope="both",
        tag_ids=[],
        today=date.today(),
        sources=SourceRegistry(),
    )
    run_id = register(ctx)
    try:
        with TestClient(test_app) as client:
            res = client.post(
                "/internal/n8n/tools/find_recordings",
                headers={"X-N8N-Secret": "test-secret"},
                json={"run_id": run_id, "text": "All Hands"},
            )
            assert res.status_code == 200
            data = res.json()
            assert "result" in data
            assert "<sources>" in data["result"]
            assert "All Hands Roadmap" in data["result"]
    finally:
        unregister(run_id)


def test_summarize_with_registered_context(test_app: Any, n8n_container: Container) -> None:
    conn = connect(n8n_container.db_path)
    try:
        analysis = MeetingSummary(
            overview="Quarterly review summary.",
            action_items=[],
            decisions=[],
            open_questions=[],
        )
        rec_id = seed_recording(conn, kind="meeting", title="Quarterly Review", analysis=analysis)
        row = conn.execute(
            "SELECT id, title, kind, created_at, duration_ms FROM recordings WHERE id = ?", (rec_id,)
        ).fetchone()
    finally:
        conn.close()

    sources = SourceRegistry()
    assert row is not None
    label = sources.add_recording(row)

    ctx = ChatContext(
        db_path=n8n_container.db_path,
        embedder=n8n_container.embedder,
        settings=n8n_container.settings,
        models=n8n_container.models,
        scope="both",
        tag_ids=[],
        today=date.today(),
        sources=sources,
    )
    run_id = register(ctx)
    try:
        with TestClient(test_app) as client:
            res = client.post(
                "/internal/n8n/tools/summarize",
                headers={"X-N8N-Secret": "test-secret"},
                json={"run_id": run_id, "sources": [label]},
            )
            assert res.status_code == 200
            data = res.json()
            assert "result" in data
            assert "Quarterly review summary." in data["result"]
    finally:
        unregister(run_id)
