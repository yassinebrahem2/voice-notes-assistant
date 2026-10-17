from pathlib import Path

from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.domain.analysis import AnalysisItem, Citation, MeetingSummary
from app.rag.vectors import unpack_embedding
from tests.seed import DEFAULT_SEGMENTS, seed_chunk, seed_recording


def test_seed_recording_creates_speakers_segments_tags_analysis(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    apply_migrations(conn)

    analysis = MeetingSummary(
        overview="Overview of budget sync.",
        decisions=[
            AnalysisItem(text="Decision 1", citations=[Citation(recording_id="rec_x", segment_id="seg_x", start_ms=0)])
        ],
        action_items=[],
        open_questions=[],
    )

    rec_id = seed_recording(
        conn,
        kind="meeting",
        status="ready",
        title="Custom Title",
        segments=DEFAULT_SEGMENTS,
        tags=["Q4", "planning"],
        analysis=analysis,
    )

    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    assert row is not None
    assert row["kind"] == "meeting"
    assert row["status"] == "ready"
    assert row["title"] == "Custom Title"
    assert row["analysis"] == analysis.model_dump_json()

    # Check speakers (labels A and B)
    speakers = conn.execute("SELECT label FROM speakers WHERE recording_id = ? ORDER BY label", (rec_id,)).fetchall()
    assert [s["label"] for s in speakers] == ["A", "B"]

    # Check segments
    segments = conn.execute("SELECT idx, text FROM segments WHERE recording_id = ? ORDER BY idx", (rec_id,)).fetchall()
    assert len(segments) == len(DEFAULT_SEGMENTS)
    assert segments[0]["text"] == DEFAULT_SEGMENTS[0][3]

    # Check tags (normalized: q4, planning)
    tags = conn.execute(
        """SELECT t.name FROM tags t
        JOIN recording_tags rt ON rt.tag_id = t.id
        WHERE rt.recording_id = ?
        ORDER BY t.name""",
        (rec_id,),
    ).fetchall()
    assert [t["name"] for t in tags] == ["planning", "q4"]

    conn.close()


def test_seed_chunk_packs_vector(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    apply_migrations(conn)

    rec_id = seed_recording(conn)
    chk_id = seed_chunk(
        conn,
        rec_id,
        first_idx=0,
        last_idx=1,
        text="Hi everyone, let's start the budget sync. Sounds good, I have the numbers ready.",
        vector=[0.1, 0.2, 0.3],
    )

    row = conn.execute("SELECT * FROM chunks WHERE id = ?", (chk_id,)).fetchone()
    assert row is not None
    assert row["recording_id"] == rec_id
    assert row["start_ms"] == DEFAULT_SEGMENTS[0][0]
    assert row["end_ms"] == DEFAULT_SEGMENTS[1][1]
    assert row["text"] == "Hi everyone, let's start the budget sync. Sounds good, I have the numbers ready."
    unpacked = unpack_embedding(row["embedding"])
    assert len(unpacked) == 3
    assert abs(unpacked[0] - 0.1) < 1e-5

    conn.close()


def test_seed_recording_defaults(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    apply_migrations(conn)

    rec_id = seed_recording(conn)
    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    assert row is not None
    assert row["kind"] == "meeting"
    assert row["status"] == "ready"
    assert row["title"] == "Budget sync"
    assert row["claimed"] == 0

    conn.close()


def test_seed_recording_claimed_and_note(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    apply_migrations(conn)

    rec_id = seed_recording(
        conn,
        kind="note",
        status="ready",
        title="Quick Note",
        segments=[(0, 1000, None, "Single note segment")],
        claimed=True,
    )
    row = conn.execute("SELECT * FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    assert row is not None
    assert row["kind"] == "note"
    assert row["claimed"] == 1

    speakers = conn.execute("SELECT * FROM speakers WHERE recording_id = ?", (rec_id,)).fetchall()
    assert len(speakers) == 0

    chk_id = seed_chunk(conn, rec_id, first_idx=0, last_idx=0, text="Single note segment", vector=[1.0, 0.0])
    chk_row = conn.execute("SELECT * FROM chunks WHERE id = ?", (chk_id,)).fetchone()
    assert chk_row is not None
    assert chk_row["start_ms"] == 0
    assert chk_row["end_ms"] == 1000

    conn.close()
