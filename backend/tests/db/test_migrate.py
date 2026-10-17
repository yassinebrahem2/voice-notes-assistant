import sqlite3
import struct
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.db import migrate
from app.db.connection import connect
from app.db.migrate import apply_migrations


@pytest.fixture
def db(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(tmp_path / "test.sqlite3")
    apply_migrations(conn)
    try:
        yield conn
    finally:
        conn.close()


def insert_recording(conn: sqlite3.Connection, recording_id: str = "rec_1", upload_id: str = "upload_1") -> None:
    conn.execute(
        """INSERT INTO recordings (id, kind, client_upload_id, status, created_at, audio_ext)
        VALUES (?, 'meeting', ?, 'uploaded', '2026-10-17T00:00:00Z', 'm4a')""",
        (recording_id, upload_id),
    )


def insert_children(conn: sqlite3.Connection) -> None:
    insert_recording(conn)
    conn.execute("INSERT INTO speakers (id, recording_id, label) VALUES ('spk_1', 'rec_1', 'A')")
    conn.executemany(
        """INSERT INTO segments (id, recording_id, idx, start_ms, end_ms, speaker_id, text)
        VALUES (?, 'rec_1', ?, ?, ?, 'spk_1', 'Hello')""",
        [("seg_1", 0, 0, 500), ("seg_2", 1, 500, 1000)],
    )
    conn.execute(
        """INSERT INTO chunks
        (id, recording_id, first_segment_id, last_segment_id, start_ms, end_ms, text, embedding)
        VALUES ('chk_1', 'rec_1', 'seg_1', 'seg_2', 0, 1000, 'Hello', ?)""",
        (struct.pack("384f", *([0.0] * 384)),),
    )
    conn.execute("INSERT INTO tags (id, name) VALUES ('tag_1', 'demo')")
    conn.execute("INSERT INTO recording_tags (recording_id, tag_id) VALUES ('rec_1', 'tag_1')")


def test_apply_migrations_creates_all_tables(db: sqlite3.Connection) -> None:
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables >= {
        "recordings",
        "speakers",
        "segments",
        "chunks",
        "tags",
        "recording_tags",
        "chats",
        "messages",
        "schema_migrations",
    }
    assert apply_migrations(db) == []
    assert [row[0] for row in db.execute("SELECT version FROM schema_migrations")] == ["001"]
    assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert db.row_factory is sqlite3.Row


def test_foreign_keys_on_and_cascade(db: sqlite3.Connection) -> None:
    assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    insert_children(db)
    db.execute("DELETE FROM recordings")
    for query in (
        "SELECT COUNT(*) FROM speakers",
        "SELECT COUNT(*) FROM segments",
        "SELECT COUNT(*) FROM chunks",
        "SELECT COUNT(*) FROM recording_tags",
    ):
        assert db.execute(query).fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM tags").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO speakers (id, recording_id, label) VALUES ('spk_2', 'missing', 'B')")


def test_deleting_speakers_nulls_segment_speaker(db: sqlite3.Connection) -> None:
    insert_children(db)
    db.execute("DELETE FROM speakers")
    assert [row[0] for row in db.execute("SELECT speaker_id FROM segments")] == [None, None]
    assert db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 1


@pytest.mark.parametrize("segment_id", ["seg_1", "seg_2"])
def test_deleting_segments_removes_chunks(db: sqlite3.Connection, segment_id: str) -> None:
    insert_children(db)
    db.execute("DELETE FROM segments WHERE id = ?", (segment_id,))
    assert db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0


def test_status_check_rejects_unknown_status(db: sqlite3.Connection) -> None:
    insert_recording(db)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE recordings SET status = 'unknown'")


def test_kind_check_rejects_unknown_kind(db: sqlite3.Connection) -> None:
    insert_recording(db)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE recordings SET kind = 'unknown'")


def test_client_upload_id_unique(db: sqlite3.Connection) -> None:
    insert_recording(db)
    with pytest.raises(sqlite3.IntegrityError):
        insert_recording(db, "rec_2")


def test_speaker_labels_and_segment_order_unique(db: sqlite3.Connection) -> None:
    insert_children(db)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO speakers (id, recording_id, label) VALUES ('spk_2', 'rec_1', 'A')")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE segments SET idx = 0 WHERE id = 'seg_2'")


def test_deleting_chat_cascades_messages(db: sqlite3.Connection) -> None:
    db.execute("INSERT INTO chats (id, created_at) VALUES ('cht_1', '2026-10-17T00:00:00Z')")
    db.execute(
        """INSERT INTO messages (id, chat_id, role, text, created_at)
        VALUES ('msg_1', 'cht_1', 'user', 'Hello', '2026-10-17T00:00:00Z')"""
    )
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE messages SET role = 'system'")
    db.execute("DELETE FROM chats")
    assert db.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 0


def test_sqlite_vec_loaded(db: sqlite3.Connection) -> None:
    vector = struct.pack("3f", 1.0, 0.0, 0.0)
    assert db.execute("SELECT vec_distance_cosine(?, ?)", (vector, vector)).fetchone()[0] == 0.0
    with pytest.raises(sqlite3.OperationalError, match="not authorized"):
        db.execute("SELECT load_extension('not-an-extension')")


def test_migration_failure_rolls_back_entire_file_and_ledger(
    db: sqlite3.Connection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    (migration_dir / "002_good.sql").write_text("CREATE TABLE retained (id INTEGER);", encoding="utf-8")
    (migration_dir / "003_bad.sql").write_text(
        "CREATE TABLE rolled_back (id INTEGER); INSERT INTO missing_table VALUES (1);", encoding="utf-8"
    )
    monkeypatch.setattr(migrate, "MIGRATIONS_DIR", migration_dir)
    with pytest.raises(sqlite3.OperationalError, match="missing_table"):
        apply_migrations(db)
    assert [row[0] for row in db.execute("SELECT version FROM schema_migrations ORDER BY version")] == ["001", "002"]
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master")}
    assert "retained" in tables
    assert "rolled_back" not in tables
    assert not db.in_transaction
    (migration_dir / "003_bad.sql").write_text("CREATE TABLE rolled_back (id INTEGER);", encoding="utf-8")
    assert apply_migrations(db) == ["003"]


def test_migration_handles_semicolons_in_strings_and_triggers(
    db: sqlite3.Connection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    (migration_dir / "002_trigger.sql").write_text(
        """CREATE TABLE audit (text TEXT);
        CREATE TRIGGER log_tag AFTER INSERT ON tags BEGIN
            INSERT INTO audit VALUES ('first; event');
            INSERT INTO audit VALUES (new.name);
        END;
        INSERT INTO tags VALUES ('tag_2', 'triggered');
        -- trailing comment
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(migrate, "MIGRATIONS_DIR", migration_dir)
    assert apply_migrations(db) == ["002"]
    assert [row[0] for row in db.execute("SELECT text FROM audit")] == ["first; event", "triggered"]


def test_migration_refuses_to_commit_callers_transaction(db: sqlite3.Connection) -> None:
    insert_recording(db)
    with pytest.raises(ValueError, match="transaction"):
        apply_migrations(db)
    assert db.in_transaction
    db.rollback()
    assert db.execute("SELECT COUNT(*) FROM recordings").fetchone()[0] == 0
