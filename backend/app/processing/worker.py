"""The single processing worker: claims one recording at a time and runs the pipeline on it."""

import logging
import sqlite3
import threading
from contextlib import closing

from app.api.errors import describe_frames
from app.container import Container
from app.db.connection import connect
from app.processing.pipeline import process_recording

logger = logging.getLogger(__name__)

# Uploads and retries wake the worker at once; the periodic re-check only covers a wake that was missed.
_IDLE_WAIT_S = 30.0

_STOP_WAIT_S = 3.0

_CANDIDATES_SQL = """
SELECT id FROM recordings WHERE claimed = 0 AND status NOT IN ('ready', 'failed') ORDER BY created_at, id
"""

# The guard repeats the candidate filter, so a recording deleted, retried or claimed since the read is skipped.
_CLAIM_SQL = "UPDATE recordings SET claimed=1 WHERE id=? AND claimed=0 AND status NOT IN ('ready','failed')"


def claim_next(conn: sqlite3.Connection) -> str | None:
    """Claims the oldest unclaimed recording in a non-terminal status; the claim is committed on return."""
    for candidate in conn.execute(_CANDIDATES_SQL).fetchall():
        with conn:
            claimed = conn.execute(_CLAIM_SQL, (candidate["id"],)).rowcount
        if claimed:
            return candidate["id"]
    return None


def recover_on_startup(conn: sqlite3.Connection) -> None:
    """Releases the claims of a previous server run, so its recordings resume at the step they were in."""
    with conn:
        conn.execute("UPDATE recordings SET claimed = 0 WHERE claimed = 1")


def _process_next(container: Container, conn: sqlite3.Connection) -> bool:
    rec_id = claim_next(conn)
    if rec_id is None:
        return False
    process_recording(container, conn, rec_id)
    return True


class Worker:
    def __init__(self, container: Container) -> None:
        self._container = container
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with closing(connect(self._container.db_path)) as conn:
            recover_on_startup(conn)
        self._stopping.clear()
        self._thread = threading.Thread(target=self._loop, name="processing-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopping.set()
        self._wake.set()
        if self._thread is not None:
            # Bounded, so shutdown never waits for a long step. A thread still busy is a daemon and dies with the
            # process; its unfinished transaction rolls back and the next start's recover_on_startup frees its claim.
            self._thread.join(timeout=_STOP_WAIT_S)
            self._thread = None

    def wake(self) -> None:
        self._wake.set()

    def run_once(self) -> bool:
        """Claims and processes one recording; False when nothing is queued."""
        with closing(connect(self._container.db_path)) as conn:
            return _process_next(self._container, conn)

    def _loop(self) -> None:
        # The thread's own connection: a sqlite3 connection is not shared between threads.
        with closing(connect(self._container.db_path)) as conn:
            while not self._stopping.is_set():
                # Cleared before looking at the queue, so a wake that comes during the look is not lost.
                self._wake.clear()
                try:
                    busy = _process_next(self._container, conn)
                except Exception as error:
                    # Step errors are recorded on the recording; this is the database itself failing. The
                    # thread keeps going, so one bad moment does not stop the queue for the whole server run.
                    logger.error("Processing worker error: %s at %s", type(error).__name__, describe_frames(error))
                    busy = False
                if not busy:
                    self._wake.wait(timeout=_IDLE_WAIT_S)
