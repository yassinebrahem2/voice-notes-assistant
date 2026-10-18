import logging
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.agents.schemas import ActionItem, Item, MeetingAnalysis, NoteAnalysis
from app.container import Container
from app.db.connection import connect
from app.domain.analysis import Citation, MeetingSummary, NoteContent
from app.domain.types import RecordingStatus
from app.processing.analysis_store import build_analysis_request, store_analysis
from app.processing.protocols import TranscriptLine
from app.rag.chunker import load_segment_rows
from tests.seed import seed_recording

SEGMENTS: tuple[tuple[int, int, str | None, str], ...] = (
    (0, 1000, "A", "Opening words."),
    (1500, 2500, "B", "Reply words."),
    (3000, 4000, "A", "Closing words."),
)


@pytest.fixture
def conn(container: Container) -> Iterator[sqlite3.Connection]:
    with closing(connect(container.db_path)) as connection:
        yield connection


def _seed(conn: sqlite3.Connection, *, status: RecordingStatus = "ready", tags: Sequence[str] = ()) -> str:
    return seed_recording(conn, segments=SEGMENTS, title=None, status=status, tags=tags)


def _segment_rows(conn: sqlite3.Connection, rec_id: str) -> list[sqlite3.Row]:
    return conn.execute("SELECT id, start_ms FROM segments WHERE recording_id = ? ORDER BY idx", (rec_id,)).fetchall()


def _speaker_ids(conn: sqlite3.Connection, rec_id: str) -> dict[str, str]:
    return {row["label"]: row["id"] for row in conn.execute("SELECT * FROM speakers WHERE recording_id = ?", (rec_id,))}


def _citation(rec_id: str, row: sqlite3.Row) -> Citation:
    return Citation(recording_id=rec_id, segment_id=row["id"], start_ms=row["start_ms"])


def _meeting(
    *,
    tags: Sequence[str] = ("demo",),
    overview: str = "Overview.",
    decisions: Sequence[Item] = (),
    action_items: Sequence[ActionItem] = (),
    open_questions: Sequence[Item] = (),
) -> MeetingAnalysis:
    # model_construct: the store must cope with what a validated model can never hold, such as five tags.
    return MeetingAnalysis.model_construct(
        title="Planning call",
        tags=list(tags),
        overview=overview,
        decisions=list(decisions),
        action_items=list(action_items),
        open_questions=list(open_questions),
    )


def _store(conn: sqlite3.Connection, rec_id: str, analysis: MeetingAnalysis | NoteAnalysis) -> None:
    with conn:
        store_analysis(conn, rec_id, analysis)


def _summary(conn: sqlite3.Connection, rec_id: str) -> MeetingSummary:
    stored = conn.execute("SELECT analysis FROM recordings WHERE id = ?", (rec_id,)).fetchone()["analysis"]
    return MeetingSummary.model_validate_json(stored)


def _tag_names(conn: sqlite3.Connection, rec_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT t.name FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id "
        "WHERE rt.recording_id = ? ORDER BY t.name",
        (rec_id,),
    )
    return [row["name"] for row in rows]


def test_build_request_numbers_lines_and_lists_most_used_tags(conn: sqlite3.Connection) -> None:
    seed_recording(conn, tags=[f"t{n:02d}" for n in range(45)])
    seed_recording(conn, tags=["t44", "t43"])
    rec_id = _seed(conn, status="analyzing")
    # A note never has speakers in the pipeline; a stray speaker row must still not label its lines.
    note_id = seed_recording(conn, kind="note", segments=[(0, 900, "A", "Only line.")], status="analyzing")

    request = build_analysis_request(conn, rec_id)

    assert request.kind == "meeting"
    assert request.lines == [
        TranscriptLine(s=1, speaker_label="A", text="Opening words."),
        TranscriptLine(s=2, speaker_label="B", text="Reply words."),
        TranscriptLine(s=3, speaker_label="A", text="Closing words."),
    ]
    assert request.tag_vocabulary == ["t43", "t44", *(f"t{n:02d}" for n in range(38))]
    note = build_analysis_request(conn, note_id)
    assert note.kind == "note"
    assert note.lines == [TranscriptLine(s=1, speaker_label=None, text="Only line.")]
    assert [row.speaker_label for row in load_segment_rows(conn, note_id)] == [None]


def test_store_maps_s_numbers_to_citations(conn: sqlite3.Connection) -> None:
    rec_id = _seed(conn)
    rows = _segment_rows(conn, rec_id)

    _store(
        conn,
        rec_id,
        _meeting(
            decisions=[Item(text="Ship it", sources=[3, 1])],
            action_items=[ActionItem(text="Write it", sources=[2], owner=None, due="Friday")],
            open_questions=[Item(text="When?", sources=[1])],
        ),
    )

    summary = _summary(conn, rec_id)
    assert summary.decisions[0].citations == [_citation(rec_id, rows[2]), _citation(rec_id, rows[0])]
    assert summary.action_items[0].citations == [_citation(rec_id, rows[1])]
    assert summary.action_items[0].due == "Friday"
    assert summary.open_questions[0].citations == [_citation(rec_id, rows[0])]
    stored = conn.execute("SELECT title FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    assert stored["title"] == "Planning call"


def test_store_note_maps_key_points_and_keeps_clean_text(conn: sqlite3.Connection) -> None:
    rec_id = seed_recording(conn, kind="note", segments=[(0, 900, None, "One."), (1000, 1900, None, "Two.")])
    rows = _segment_rows(conn, rec_id)

    _store(
        conn,
        rec_id,
        NoteAnalysis(
            title="My note", tags=["ideas"], key_points=[Item(text="Point", sources=[2])], clean_text="One. Two."
        ),
    )

    stored = conn.execute("SELECT analysis FROM recordings WHERE id = ?", (rec_id,)).fetchone()["analysis"]
    note = NoteContent.model_validate_json(stored)
    assert note.key_points[0].citations == [_citation(rec_id, rows[1])]
    assert note.clean_text == "One. Two."


def test_store_drops_unknown_s_and_empty_items_and_logs(
    conn: sqlite3.Connection, caplog: pytest.LogCaptureFixture
) -> None:
    rec_id = _seed(conn)
    rows = _segment_rows(conn, rec_id)

    with caplog.at_level(logging.WARNING, logger="app.processing.analysis_store"):
        _store(
            conn,
            rec_id,
            _meeting(
                decisions=[Item(text="Kept decision", sources=[1, 99]), Item(text="Secret decision", sources=[42])],
                action_items=[ActionItem(text="Secret action", sources=[0], owner="A", due=None)],
                open_questions=[Item(text="Secret question", sources=[-1, 4])],
            ),
        )

    summary = _summary(conn, rec_id)
    assert [item.text for item in summary.decisions] == ["Kept decision"]
    assert summary.decisions[0].citations == [_citation(rec_id, rows[0])]
    assert summary.action_items == []
    assert summary.open_questions == []
    assert rec_id in caplog.text
    for number in ("99", "42", "0", "-1", "4"):
        assert f"S{number} " in caplog.text
    assert "Secret" not in caplog.text and "Kept" not in caplog.text
    assert caplog.text.count("without a valid source") == 3


def test_store_owner_label_to_speaker_id_unknown_null(
    conn: sqlite3.Connection, caplog: pytest.LogCaptureFixture
) -> None:
    rec_id = _seed(conn)
    speakers = _speaker_ids(conn, rec_id)

    with caplog.at_level(logging.WARNING, logger="app.processing.analysis_store"):
        _store(
            conn,
            rec_id,
            _meeting(
                action_items=[
                    ActionItem(text="Known", sources=[1], owner="B", due="Monday"),
                    ActionItem(text="Unknown", sources=[1], owner="Private Name", due=None),
                    ActionItem(text="Nobody", sources=[1], owner=None, due=None),
                ]
            ),
        )

    items = _summary(conn, rec_id).action_items
    owners = [(item.owner_speaker_id, item.due) for item in items]
    assert owners == [(speakers["B"], "Monday"), (None, None), (None, None)]
    assert rec_id in caplog.text and "owner" in caplog.text
    assert "Private Name" not in caplog.text
    assert len([record for record in caplog.records if "owner" in record.getMessage()]) == 1


def test_store_tokenizes_speakers_then_detail_renders_names(client: TestClient, conn: sqlite3.Connection) -> None:
    rec_id = _seed(conn)
    speakers = _speaker_ids(conn, rec_id)

    _store(
        conn,
        rec_id,
        _meeting(
            overview="Speaker A asked and Speaker B's answer came; Speaker C is not here.",
            decisions=[Item(text="Speaker B decides", sources=[1])],
            action_items=[ActionItem(text="Speaker A writes", sources=[1], owner="A", due=None)],
            open_questions=[Item(text="Does Speaker B agree?", sources=[1])],
        ),
    )
    note_id = seed_recording(conn, kind="note", segments=[(0, 900, None, "One.")])
    _store(
        conn,
        note_id,
        NoteAnalysis(
            title="Note", tags=["x"], key_points=[Item(text="Speaker A said", sources=[1])], clean_text="Speaker A"
        ),
    )

    summary = _summary(conn, rec_id)
    a, b = "{{" + speakers["A"] + "}}", "{{" + speakers["B"] + "}}"
    assert summary.overview == f"{a} asked and {b}'s answer came; Speaker C is not here."
    assert summary.decisions[0].text == f"{b} decides"
    assert summary.action_items[0].text == f"{a} writes"
    assert summary.open_questions[0].text == f"Does {b} agree?"
    title = conn.execute("SELECT title FROM recordings WHERE id = ?", (rec_id,)).fetchone()["title"]
    assert title == "Planning call"

    response = client.patch(f"/api/v1/recordings/{rec_id}/speakers/{speakers['B']}", json={"name": "Bob"})
    assert response.status_code == 200
    rendered = client.get(f"/api/v1/recordings/{rec_id}").json()["summary"]
    assert rendered["overview"] == "Speaker A asked and Bob's answer came; Speaker C is not here."
    assert rendered["decisions"][0]["text"] == "Bob decides"
    assert rendered["open_questions"][0]["text"] == "Does Bob agree?"
    # A note has no speakers, so nothing is tokenized.
    note = client.get(f"/api/v1/recordings/{note_id}").json()["note"]
    assert note["clean_text"] == "Speaker A"


def test_store_tags_reuse_and_cap_4(conn: sqlite3.Connection) -> None:
    seed_recording(conn, tags=["budget", "legacy"])
    rec_id = _seed(conn, tags=["legacy"])
    existing_budget = conn.execute("SELECT id FROM tags WHERE name = 'budget'").fetchone()["id"]

    _store(conn, rec_id, _meeting(tags=["Budgets", " Q3  Plans ", "BUDGET", "   ", "Roadmap", "hiring", "ops"]))

    assert _tag_names(conn, rec_id) == ["budget", "hiring", "q3-plans", "roadmap"]
    linked = conn.execute(
        "SELECT t.id FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recording_id = ? AND t.name = ?",
        (rec_id, "budget"),
    ).fetchone()
    assert linked["id"] == existing_budget
    assert conn.execute("SELECT 1 FROM tags WHERE name IN ('ops', '')").fetchall() == []

    _store(conn, rec_id, _meeting(tags=["ops", "q3 plan"]))

    assert _tag_names(conn, rec_id) == ["ops", "q3-plans"]
    # Tags no longer linked to this recording stay, as a PATCH leaves them.
    assert conn.execute("SELECT 1 FROM tags WHERE name = 'roadmap'").fetchone() is not None
    assert conn.execute("SELECT COUNT(*) AS n FROM tags WHERE name LIKE 'q3%'").fetchone()["n"] == 1


def test_store_never_commits(conn: sqlite3.Connection, container: Container) -> None:
    rec_id = _seed(conn)

    store_analysis(conn, rec_id, _meeting(tags=["fresh"], decisions=[Item(text="x", sources=[1])]))
    assert conn.in_transaction
    conn.rollback()

    with closing(connect(container.db_path)) as other:
        row = other.execute("SELECT title, analysis FROM recordings WHERE id = ?", (rec_id,)).fetchone()
        assert (row["title"], row["analysis"]) == (None, None)
        assert other.execute("SELECT 1 FROM tags WHERE name = 'fresh'").fetchall() == []
