from collections.abc import Sequence

from fastapi.testclient import TestClient

from app.container import Container
from app.db.connection import connect
from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.types import RecordingKind, RecordingStatus
from tests.seed import DEFAULT_SEGMENTS, seed_recording

SEGMENTS_ONE = ((0, 1000, "A", "alpha text"),)


def _seed(
    container: Container,
    *,
    kind: RecordingKind = "meeting",
    status: RecordingStatus = "ready",
    title: str | None = "Budget sync",
    segments: Sequence[tuple[int, int, str | None, str]] = DEFAULT_SEGMENTS,
    tags: Sequence[str] = (),
    analysis: MeetingSummary | NoteContent | None = None,
    created_at: str | None = None,
    claimed: bool = False,
) -> str:
    conn = connect(container.db_path)
    try:
        return seed_recording(
            conn,
            kind=kind,
            status=status,
            title=title,
            segments=segments,
            tags=tags,
            analysis=analysis,
            created_at=created_at,
            claimed=claimed,
        )
    finally:
        conn.close()


def _ids(client: TestClient, params: dict[str, str | list[str]] | None = None) -> list[str]:
    response = client.get("/api/v1/recordings", params=params)
    assert response.status_code == 200
    return [item["id"] for item in response.json()]


def test_list_newest_first_and_kind_filter(client: TestClient, container: Container) -> None:
    old = _seed(container, title="Old", created_at="2026-01-01T00:00:00Z")
    new = _seed(container, title="New", kind="note", created_at="2026-03-01T00:00:00Z")
    mid = _seed(container, title="Mid", status="failed", created_at="2026-02-01T00:00:00Z", claimed=True)

    assert _ids(client) == [new, mid, old]
    assert _ids(client, {"kind": "note"}) == [new]
    assert _ids(client, {"kind": "meeting"}) == [mid, old]

    items = {item["id"]: item for item in client.get("/api/v1/recordings").json()}
    assert items[mid]["processing"] is True
    assert items[old]["processing"] is False
    assert items[old]["waveform_peaks"] is None


def test_list_search_matches_title_tag_and_transcript(client: TestClient, container: Container) -> None:
    by_title = _seed(container, title="Zebra planning", segments=SEGMENTS_ONE, created_at="2026-01-01T00:00:00Z")
    by_tag = _seed(container, title="Other", segments=SEGMENTS_ONE, tags=["zebra"], created_at="2026-01-02T00:00:00Z")
    by_text = _seed(
        container,
        title="Third",
        segments=((0, 1000, "A", "the ZEBRA crossed"), (1000, 2000, "B", "another zebra")),
        created_at="2026-01-03T00:00:00Z",
    )
    _seed(container, title="Unrelated", segments=SEGMENTS_ONE, created_at="2026-01-04T00:00:00Z")

    assert _ids(client, {"q": "zebra"}) == [by_text, by_tag, by_title]
    assert _ids(client, {"q": "nothing-matches"}) == []


def test_search_escapes_like_wildcards(client: TestClient, container: Container) -> None:
    literal = _seed(container, title="Growth 50% target", segments=SEGMENTS_ONE)
    _seed(container, title="Plain", segments=SEGMENTS_ONE)
    # Without escaping, "50%" becomes the pattern "%50%%" and would also match this "50" not followed by "%".
    _seed(container, title="500 users", segments=SEGMENTS_ONE)
    underscore = _seed(container, title="snake_case name", segments=SEGMENTS_ONE)
    _seed(container, title="snakeXcase name", segments=SEGMENTS_ONE)

    assert _ids(client, {"q": "50%"}) == [literal]
    assert _ids(client, {"q": "e_c"}) == [underscore]
    assert _ids(client, {"q": "\\"}) == []
    backslash = _seed(container, title="back\\slash", segments=SEGMENTS_ONE)
    assert _ids(client, {"q": "\\"}) == [backslash]


def test_list_tag_filter_requires_all_tags(client: TestClient, container: Container) -> None:
    both = _seed(container, tags=["alpha", "beta"])
    _seed(container, tags=["alpha"])
    _seed(container, tags=["beta"])
    tags = {tag["name"]: tag["id"] for tag in client.get("/api/v1/tags").json()}

    assert _ids(client, {"tag_id": [tags["alpha"], tags["beta"]]}) == [both]
    assert _ids(client, {"tag_id": [tags["alpha"], tags["alpha"], tags["beta"]]}) == [both]
    assert _ids(client, {"tag_id": [tags["alpha"], "tag_unknown"]}) == []
    assert _ids(client, {"kind": "note", "tag_id": [tags["alpha"]]}) == []


def test_search_combined_with_kind_and_tag_is_an_and(client: TestClient, container: Container) -> None:
    both = _seed(container, title="Zebra meeting", kind="meeting", tags=["alpha"], segments=SEGMENTS_ONE)
    wrong_kind = _seed(container, title="Zebra note", kind="note", tags=["alpha"], segments=SEGMENTS_ONE)
    wrong_tag = _seed(container, title="Zebra other", kind="meeting", tags=["beta"], segments=SEGMENTS_ONE)
    tags = {tag["name"]: tag["id"] for tag in client.get("/api/v1/tags").json()}

    assert set(_ids(client, {"q": "zebra"})) == {both, wrong_kind, wrong_tag}
    assert _ids(client, {"q": "zebra", "kind": "meeting", "tag_id": [tags["alpha"]]}) == [both]
    assert _ids(client, {"q": "zebra", "kind": "note"}) == [wrong_kind]
    assert _ids(client, {"q": "zebra", "tag_id": [tags["beta"]]}) == [wrong_tag]


def test_equal_timestamps_are_ordered_by_id_descending(client: TestClient, container: Container) -> None:
    same = "2026-05-05T00:00:00Z"
    ids = [_seed(container, title=f"Same {n}", created_at=same) for n in range(3)]

    assert _ids(client) == sorted(ids, reverse=True)


def test_recording_tags_carry_counts_in_name_order(client: TestClient, container: Container) -> None:
    rec = _seed(container, tags=["beta", "alpha"])
    _seed(container, tags=["alpha"])

    item = next(i for i in client.get("/api/v1/recordings").json() if i["id"] == rec)
    assert [(t["name"], t["count"]) for t in item["tags"]] == [("alpha", 2), ("beta", 1)]


def test_detail_renders_speaker_names_in_summary(client: TestClient, container: Container) -> None:
    summary_rec = _seed(container, segments=((0, 1000, "A", "hi"), (1000, 2000, "B", "yo")))
    conn = connect(container.db_path)
    try:
        speaker_a = conn.execute(
            "SELECT id FROM speakers WHERE recording_id = ? AND label = 'A'", (summary_rec,)
        ).fetchone()["id"]
        stored = MeetingSummary(
            overview="{{" + speaker_a + "}} will send it", decisions=[], action_items=[], open_questions=[]
        )
        conn.execute("UPDATE recordings SET analysis = ? WHERE id = ?", (stored.model_dump_json(), summary_rec))
        conn.commit()
    finally:
        conn.close()

    unnamed = client.get(f"/api/v1/recordings/{summary_rec}").json()
    assert unnamed["summary"]["overview"] == "Speaker A will send it"
    assert unnamed["note"] is None
    assert [s["idx"] for s in unnamed["segments"]] == [0, 1]
    assert {s["label"]: s["display_name"] for s in unnamed["speakers"]} == {"A": "Speaker A", "B": "Speaker B"}

    conn = connect(container.db_path)
    try:
        conn.execute("UPDATE speakers SET name = 'Sarah' WHERE id = ?", (speaker_a,))
        conn.commit()
    finally:
        conn.close()

    renamed = client.get(f"/api/v1/recordings/{summary_rec}").json()
    assert renamed["summary"]["overview"] == "Sarah will send it"
    speaker = next(s for s in renamed["speakers"] if s["label"] == "A")
    assert (speaker["name"], speaker["display_name"]) == ("Sarah", "Sarah")


def test_detail_returns_note_and_handles_missing_analysis(client: TestClient, container: Container) -> None:
    note = NoteContent(key_points=[], clean_text="Clean words")
    note_rec = _seed(container, kind="note", analysis=note)
    pending = _seed(container, status="transcribing", claimed=True)

    detail = client.get(f"/api/v1/recordings/{note_rec}").json()
    assert detail["note"]["clean_text"] == "Clean words"
    assert detail["summary"] is None

    waiting = client.get(f"/api/v1/recordings/{pending}").json()
    assert waiting["summary"] is None
    assert waiting["note"] is None
    assert waiting["processing"] is True


def test_detail_parses_waveform_peaks(client: TestClient, container: Container) -> None:
    rec = _seed(container)
    conn = connect(container.db_path)
    try:
        conn.execute("UPDATE recordings SET waveform_peaks = '[0.25, 1.0]' WHERE id = ?", (rec,))
        conn.commit()
    finally:
        conn.close()

    assert client.get(f"/api/v1/recordings/{rec}").json()["waveform_peaks"] == [0.25, 1.0]


def test_detail_unknown_id_is_404_contract_shape(client: TestClient) -> None:
    response = client.get("/api/v1/recordings/rec_missing")

    assert response.status_code == 404
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "not_found"
    assert isinstance(body["error"]["message"], str)


def test_tags_with_counts(client: TestClient, container: Container) -> None:
    _seed(container, tags=["beta", "alpha"])
    _seed(container, tags=["alpha"])
    conn = connect(container.db_path)
    try:
        conn.execute("INSERT INTO tags (id, name) VALUES ('tag_unused', 'unused')")
        conn.commit()
    finally:
        conn.close()

    result = client.get("/api/v1/tags").json()
    assert [(t["name"], t["count"]) for t in result] == [("alpha", 2), ("beta", 1), ("unused", 0)]


def test_failed_recording_exposes_error_fields(client: TestClient, container: Container) -> None:
    rec = _seed(container, status="failed")
    conn = connect(container.db_path)
    try:
        conn.execute(
            "UPDATE recordings SET failed_step = 'transcribing', error_code = 'transcription_failed', "
            "error_message = 'ASR crashed' WHERE id = ?",
            (rec,),
        )
        conn.commit()
    finally:
        conn.close()

    listed = next(i for i in client.get("/api/v1/recordings").json() if i["id"] == rec)
    detail = client.get(f"/api/v1/recordings/{rec}").json()
    for body in (listed, detail):
        assert body["status"] == "failed"
        assert body["failed_step"] == "transcribing"
        assert body["error_code"] == "transcription_failed"
        assert body["error_message"] == "ASR crashed"
