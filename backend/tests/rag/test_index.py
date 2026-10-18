import dataclasses
import math
from collections.abc import Sequence
from contextlib import closing

from fastapi.testclient import TestClient

from app.agents.schemas import MeetingAnalysis, NoteAnalysis
from app.container import Container
from app.db.connection import connect
from app.domain.types import RecordingKind
from app.processing.fakes import FakeAnalyzer
from app.processing.pipeline import process_recording
from app.processing.protocols import AnalysisRequest
from app.rag.index import index_recording
from app.rag.vectors import pack_embedding
from tests.seed import seed_chunk, seed_recording


def _rows(container: Container, sql: str, params: Sequence[str | int | None] = ()) -> list[dict[str, object]]:
    with closing(connect(container.db_path)) as conn, conn:
        return [dict(row) for row in conn.execute(sql, tuple(params))]


# Six segments of about 40 tokens each, two speakers: enough for more than one chunk.
LONG_SEGMENTS = [(i * 1000, i * 1000 + 900, "A" if i < 3 else "B", f"Segment {i} " + "w" * 150) for i in range(6)]


def _seed_analyzing(container: Container, kind: RecordingKind = "meeting", *, long: bool = False) -> str:
    with closing(connect(container.db_path)) as conn:
        if long:
            return seed_recording(conn, kind=kind, status="analyzing", title=None, claimed=True, segments=LONG_SEGMENTS)
        return seed_recording(conn, kind=kind, status="analyzing", title=None, claimed=True)


def _segments(container: Container, rec_id: str) -> list[dict[str, object]]:
    return _rows(container, "SELECT id, start_ms FROM segments WHERE recording_id = ? ORDER BY idx", (rec_id,))


def _chunk_count(container: Container, rec_id: str) -> int:
    count = _rows(container, "SELECT COUNT(*) AS n FROM chunks WHERE recording_id = ?", (rec_id,))[0]["n"]
    assert isinstance(count, int)
    return count


def test_index_replaces_chunks_and_vec_distance_works(container: Container) -> None:
    with closing(connect(container.db_path)) as conn:
        rec_id = seed_recording(conn, status="indexing", segments=LONG_SEGMENTS, claimed=True)
        old = seed_chunk(conn, rec_id, first_idx=0, last_idx=1, text="old chunk", vector=[1.0] * 384)

        count = index_recording(conn, container.embedder, rec_id, container.settings)
        assert not conn.in_transaction

        assert count == _chunk_count(container, rec_id)
        assert count >= 2
        assert _rows(container, "SELECT 1 FROM chunks WHERE id = ?", (old,)) == []
        row = _rows(container, "SELECT status, claimed FROM recordings WHERE id = ?", (rec_id,))[0]
        assert (row["status"], row["claimed"]) == ("ready", 0)
        seg_rows = _rows(
            container, "SELECT id, idx, start_ms, end_ms FROM segments WHERE recording_id = ? ORDER BY idx", (rec_id,)
        )
        chunks = _rows(
            container,
            "SELECT c.*, f.idx AS first_idx, l.idx AS last_idx FROM chunks c "
            "JOIN segments f ON f.id = c.first_segment_id JOIN segments l ON l.id = c.last_segment_id "
            "WHERE c.recording_id = ? ORDER BY f.idx",
            (rec_id,),
        )
        assert chunks[0]["first_segment_id"] == seg_rows[0]["id"]
        assert chunks[-1]["last_segment_id"] == seg_rows[-1]["id"]
        for chunk in chunks:
            assert isinstance(chunk["first_idx"], int) and isinstance(chunk["last_idx"], int)
            assert chunk["start_ms"] == seg_rows[chunk["first_idx"]]["start_ms"]
            assert chunk["end_ms"] == seg_rows[chunk["last_idx"]]["end_ms"]
            assert str(chunk["text"]).startswith("Speaker ")
            query = pack_embedding(container.embedder.embed_query(str(chunk["text"])))
            (distance,) = conn.execute(
                "SELECT vec_distance_cosine(embedding, ?) FROM chunks WHERE id = ?", (query, chunk["id"])
            ).fetchone()
            assert math.isclose(distance, 0.0, abs_tol=1e-5)
            other = pack_embedding(container.embedder.embed_query("an unrelated text"))
            (far,) = conn.execute(
                "SELECT vec_distance_cosine(embedding, ?) FROM chunks WHERE id = ?", (other, chunk["id"])
            ).fetchone()
            assert far > 0.5

        assert index_recording(conn, container.embedder, rec_id, container.settings) == count
    assert _chunk_count(container, rec_id) == count


def test_meeting_ready_has_summary_and_chunks(client: TestClient, container: Container) -> None:
    rec_id = _seed_analyzing(container)
    first = _segments(container, rec_id)[0]

    with closing(connect(container.db_path)) as conn:
        process_recording(container, conn, rec_id)

    detail = client.get(f"/api/v1/recordings/{rec_id}").json()
    assert detail["status"] == "ready"
    assert detail["title"] == "Fake analysis"
    assert [tag["name"] for tag in detail["tags"]] == ["demo"]
    summary = detail["summary"]
    assert summary is not None
    assert summary["decisions"][0]["citations"] == [
        {"recording_id": rec_id, "segment_id": first["id"], "start_ms": first["start_ms"]}
    ]
    assert _rows(container, "SELECT claimed FROM recordings WHERE id = ?", (rec_id,))[0]["claimed"] == 0
    assert _chunk_count(container, rec_id) >= 1


def test_note_ready_has_note_and_chunks(client: TestClient, container: Container) -> None:
    rec_id = _seed_analyzing(container, kind="note")

    with closing(connect(container.db_path)) as conn:
        process_recording(container, conn, rec_id)

    detail = client.get(f"/api/v1/recordings/{rec_id}").json()
    assert detail["status"] == "ready"
    assert detail["summary"] is None
    assert detail["note"]["key_points"][0]["text"] == "Demo key point"
    assert _chunk_count(container, rec_id) >= 1


def test_analyze_and_embed_run_with_no_transaction_open(container: Container) -> None:
    rec_id = _seed_analyzing(container, long=True)
    with closing(connect(container.db_path)) as conn:
        seen: list[bool] = []

        class Analyzer:
            def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis:
                seen.append(conn.in_transaction)
                return FakeAnalyzer().analyze(request)

        class Embedder:
            dim = container.embedder.dim

            def __init__(self) -> None:
                self.batches: list[list[str]] = []

            def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
                seen.append(conn.in_transaction)
                self.batches.append(list(texts))
                return container.embedder.embed_passages(texts)

            def embed_query(self, text: str) -> list[float]:
                return container.embedder.embed_query(text)

        embedder = Embedder()
        process_recording(dataclasses.replace(container, analyzer=Analyzer(), embedder=embedder), conn, rec_id)

    assert seen == [False, False]
    # One batch for all the chunks, never one call per chunk.
    assert len(embedder.batches) == 1
    assert len(embedder.batches[0]) >= 2
    stored = _rows(container, "SELECT text FROM chunks WHERE recording_id = ?", (rec_id,))
    assert sorted(embedder.batches[0]) == sorted(str(row["text"]) for row in stored)
