"""Apply numbered SQL files atomically, together with their migration ledger entry."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def _statements(script: str) -> Iterator[str]:
    start = 0
    for index, char in enumerate(script):
        if char == ";" and sqlite3.complete_statement(script[start : index + 1]):
            yield script[start : index + 1]
            start = index + 1
    if script[start:].strip():
        yield script[start:]


def apply_migrations(conn: sqlite3.Connection) -> list[str]:
    """Apply pending migrations in order without committing a caller's transaction."""
    if conn.in_transaction:
        raise ValueError("Migrations require a connection without an active transaction")
    with conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )"""
        )
    applied: list[str] = []
    for path in sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql")):
        version = path.stem.split("_", 1)[0]
        with conn:
            # Serialize startup processes before reading the ledger or changing the schema.
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM schema_migrations WHERE version = ?", (version,)).fetchone():
                continue
            # executescript() commits implicitly, which would break file-level rollback.
            for statement in _statements(path.read_text(encoding="utf-8")):
                conn.execute(statement)
            conn.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                (version,),
            )
        applied.append(version)
    return applied
