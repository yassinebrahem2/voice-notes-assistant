import concurrent.futures
import contextlib
import sqlite3
from pathlib import Path

import pytest

from app.api.deps import get_db
from app.container import Container
from app.db.connection import connect


def test_get_db_connection_usable_across_threads(tmp_path: Path, container: Container) -> None:
    db_path = tmp_path / "thread_test.sqlite3"
    conn_default = connect(db_path)
    conn_default.execute("CREATE TABLE t (x INT)")
    conn_default.commit()

    def run_query(conn: sqlite3.Connection) -> int:
        cursor = conn.execute("SELECT 1")
        row = cursor.fetchone()
        return row[0] if row else 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(run_query, conn_default)
        with pytest.raises(sqlite3.ProgrammingError, match="same thread"):
            future.result()
    conn_default.close()

    db_gen = get_db(container)
    conn_shared = next(db_gen)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(run_query, conn_shared)
            assert future.result() == 1
    finally:
        with contextlib.suppress(StopIteration):
            next(db_gen)
