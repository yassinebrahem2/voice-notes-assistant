from pathlib import Path

from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.rag.fakes import FakeEmbedder
from app.rag.retrieve import search_chunks
from tests.seed import seed_chunk, seed_recording


def test_scope_filters_kind(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()
        v_match = embedder.embed_query("sync")

        rec_note = seed_recording(conn, kind="note", title="Architecture note")
        seed_chunk(conn, rec_note, first_idx=0, last_idx=0, text="Architecture details", vector=v_match)

        rec_meeting = seed_recording(conn, kind="meeting", title="Weekly sync")
        seed_chunk(conn, rec_meeting, first_idx=0, last_idx=0, text="Weekly sync notes", vector=v_match)

        notes_hits = search_chunks(conn, embedder, "sync", scope="notes", tag_ids=[], k=10, max_distance=1.0)
        assert len(notes_hits) == 1
        assert notes_hits[0].recording_id == rec_note
        assert notes_hits[0].kind == "note"

        meeting_hits = search_chunks(conn, embedder, "sync", scope="meetings", tag_ids=[], k=10, max_distance=1.0)
        assert len(meeting_hits) == 1
        assert meeting_hits[0].recording_id == rec_meeting
        assert meeting_hits[0].kind == "meeting"

        both_hits = search_chunks(conn, embedder, "sync", scope="both", tag_ids=[], k=10, max_distance=1.0)
        assert len(both_hits) == 2
        rec_ids = {h.recording_id for h in both_hits}
        assert rec_ids == {rec_note, rec_meeting}
    finally:
        conn.close()


def test_tag_filter_requires_all(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()
        v_match = embedder.embed_query("planning")

        rec_both = seed_recording(conn, title="Both tags", tags=["alpha", "beta"])
        seed_chunk(conn, rec_both, first_idx=0, last_idx=0, text="Both tags content", vector=v_match)

        rec_alpha = seed_recording(conn, title="Alpha only", tags=["alpha"])
        seed_chunk(conn, rec_alpha, first_idx=0, last_idx=0, text="Alpha only content", vector=v_match)

        rec_beta = seed_recording(conn, title="Beta only", tags=["beta"])
        seed_chunk(conn, rec_beta, first_idx=0, last_idx=0, text="Beta only content", vector=v_match)

        row_a = conn.execute("SELECT id FROM tags WHERE name = 'alpha'").fetchone()
        row_b = conn.execute("SELECT id FROM tags WHERE name = 'beta'").fetchone()
        assert row_a is not None and row_b is not None
        tag_a = str(row_a[0])
        tag_b = str(row_b[0])

        hits_both = search_chunks(
            conn,
            embedder,
            "planning",
            scope="both",
            tag_ids=[tag_a, tag_b],
            k=10,
            max_distance=1.0,
        )
        assert len(hits_both) == 1
        assert hits_both[0].recording_id == rec_both

        hits_alpha = search_chunks(
            conn,
            embedder,
            "planning",
            scope="both",
            tag_ids=[tag_a],
            k=10,
            max_distance=1.0,
        )
        rec_ids_alpha = {h.recording_id for h in hits_alpha}
        assert rec_ids_alpha == {rec_both, rec_alpha}
    finally:
        conn.close()


def test_only_ready_recordings(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()
        v_match = embedder.embed_query("status check")

        rec_ready = seed_recording(conn, status="ready", title="Ready recording")
        seed_chunk(conn, rec_ready, first_idx=0, last_idx=0, text="Ready text", vector=v_match)

        rec_transcribing = seed_recording(conn, status="transcribing", title="Transcribing recording")
        seed_chunk(conn, rec_transcribing, first_idx=0, last_idx=0, text="Transcribing text", vector=v_match)

        rec_failed = seed_recording(conn, status="failed", title="Failed recording")
        seed_chunk(conn, rec_failed, first_idx=0, last_idx=0, text="Failed text", vector=v_match)

        hits = search_chunks(conn, embedder, "status check", scope="both", tag_ids=[], k=10, max_distance=1.0)
        assert len(hits) == 1
        assert hits[0].recording_id == rec_ready
    finally:
        conn.close()


def test_max_distance_drops_far_hits(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()
        v_query = embedder.embed_query("target")
        v_far = [-x for x in v_query]

        rec_close = seed_recording(conn, title="Close hit")
        seed_chunk(conn, rec_close, first_idx=0, last_idx=0, text="Close text", vector=v_query)

        rec_far = seed_recording(conn, title="Far hit")
        seed_chunk(conn, rec_far, first_idx=0, last_idx=0, text="Far text", vector=v_far)

        hits = search_chunks(conn, embedder, "target", scope="both", tag_ids=[], k=10, max_distance=0.5)
        assert len(hits) == 1
        assert hits[0].recording_id == rec_close
        assert hits[0].distance < 0.5
    finally:
        conn.close()


def test_adjacent_hits_merged(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()
        v_query = embedder.embed_query("merged content")

        segments = [
            (0, 3000, "A", "Part one."),
            (3000, 6000, "B", "Part two."),
            (8000, 11000, "A", "Part three."),
        ]
        rec_id = seed_recording(conn, title="Segmented talk", segments=segments)

        first_seg_row = conn.execute("SELECT id FROM segments WHERE recording_id = ? AND idx = 0", (rec_id,)).fetchone()
        assert first_seg_row is not None
        seg0_id = str(first_seg_row[0])

        seed_chunk(conn, rec_id, first_idx=0, last_idx=0, text="Part one.", vector=v_query)
        seed_chunk(conn, rec_id, first_idx=1, last_idx=1, text="Part two.", vector=v_query)
        seed_chunk(conn, rec_id, first_idx=2, last_idx=2, text="Part three.", vector=v_query)

        hits = search_chunks(conn, embedder, "merged content", scope="both", tag_ids=[], k=10, max_distance=1.0)
        assert len(hits) == 2

        hit_merged = next(h for h in hits if h.start_ms == 0)
        assert hit_merged.end_ms == 6000
        assert hit_merged.first_segment_id == seg0_id
        assert hit_merged.text == "Part one.\nPart two."

        hit_separate = next(h for h in hits if h.start_ms == 8000)
        assert hit_separate.end_ms == 11000
        assert hit_separate.text == "Part three."
    finally:
        conn.close()
