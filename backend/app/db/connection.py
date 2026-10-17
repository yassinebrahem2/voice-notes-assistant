"""Connections configured consistently for every database consumer."""

import sqlite3
from pathlib import Path

import sqlite_vec  # pyright: ignore[reportMissingTypeStubs] -- sqlite-vec does not publish type stubs.


def connect(db_path: Path) -> sqlite3.Connection:
    """Open the database with referential integrity and vector functions enabled."""
    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.enable_load_extension(True)
        try:
            sqlite_vec.load(conn)
        finally:
            conn.enable_load_extension(False)
    except Exception:
        conn.close()
        raise
    return conn
