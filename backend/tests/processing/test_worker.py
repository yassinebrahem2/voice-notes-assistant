import dataclasses
import logging
import sqlite3
import threading
import time
from collections.abc import Callable, Generator, Sequence
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Literal

import pytest
from fastapi.testclient import TestClient

from app.api.app import create_app
from app.audio.storage import audio_path
from app.container import Container
from app.db.connection import connect
from app.domain.types import RecordingStatus
from app.processing import wake_worker
from app.processing.worker import Worker, claim_next, recover_on_startup
from app.speech.fakes import FakeAsr, FakeDiarizer
from app.speech.protocols import AsrSegment, DiarTurn
from tests.fixtures.audio_gen import sine_m4a, sine_wav
from tests.seed import seed_recording

WAIT_S = 10.0
T0, T1, T2, T3 = (f"2026-10-17T00:00:0{second}Z" for second in range(4))


class SignallingAsr:
    def __init__(self) -> None:
        self.called = threading.Event()

    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        self.called.set()
        return FakeAsr().transcribe(audio_npy)


class BlockingSpeech:
    """Holds one speech step open until the test releases it, like a slow ASR or diarizer child."""

    def __init__(self, blocked: Literal["transcribing", "diarizing"]) -> None:
        self.blocked = blocked
        self.entered = threading.Event()
        self.release = threading.Event()

    def _hold(self) -> None:
        self.entered.set()
        if not self.release.wait(timeout=WAIT_S):
            raise TimeoutError("The test never released the speech step.")

    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        if self.blocked == "transcribing":
            self._hold()
        return FakeAsr().transcribe(audio_npy)

    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        if self.blocked == "diarizing":
            self._hold()
        return FakeDiarizer().diarize(audio_npy)


class SignallingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.emitted = threading.Event()

    def emit(self, record: logging.LogRecord) -> None:
        self.emitted.set()


def _queue(
    container: Container,
    *,
    status: RecordingStatus = "uploaded",
    created_at: str | None = None,
    claimed: bool = False,
    audio: bytes | None = None,
) -> str:
    with closing(connect(container.db_path)) as conn:
        rec_id = seed_recording(conn, status=status, title=None, segments=(), created_at=created_at, claimed=claimed)
    path = audio_path(container.settings.data_dir, rec_id, "m4a")
    path.parent.mkdir(parents=True, exist_ok=True)
    if audio is None:
        sine_m4a(path)
    else:
        path.write_bytes(audio)
    return rec_id


def _execute(container: Container, sql: str, params: Sequence[str | int | None] = ()) -> list[dict[str, object]]:
    with closing(connect(container.db_path)) as conn, conn:
        return [dict(row) for row in conn.execute(sql, tuple(params))]


def _row(container: Container, rec_id: str) -> dict[str, object]:
    return _execute(container, "SELECT status, claimed, error_code FROM recordings WHERE id = ?", (rec_id,))[0]


def _signal_empty_claims(monkeypatch: pytest.MonkeyPatch) -> threading.Event:
    """Set once the worker finds the queue empty: its next move is the long idle wait, which only a wake ends."""
    found_empty = threading.Event()

    def claim_and_signal(conn: sqlite3.Connection) -> str | None:
        rec_id = claim_next(conn)
        if rec_id is None:
            found_empty.set()
        return rec_id

    monkeypatch.setattr("app.processing.worker.claim_next", claim_and_signal)
    return found_empty


@contextmanager
def _running(target: Callable[[], object]) -> Generator[list[Exception]]:
    """Runs target in a thread, joins it on exit and collects what it raised, so no failure is lost."""
    errors: list[Exception] = []

    def run() -> None:
        try:
            target()
        except Exception as error:
            errors.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    try:
        yield errors
    finally:
        thread.join(timeout=WAIT_S)
        assert not thread.is_alive()


def test_claim_takes_the_oldest_unclaimed_non_terminal_recording(container: Container) -> None:
    _queue(container, status="ready", created_at=T0)
    _queue(container, status="failed", created_at=T0)
    _queue(container, claimed=True, created_at=T0)
    newer = _queue(container, status="diarizing", created_at=T3)
    oldest = _queue(container, created_at=T1)

    with closing(connect(container.db_path)) as conn:
        assert claim_next(conn) == oldest
        assert not conn.in_transaction

    assert _row(container, oldest)["claimed"] == 1
    assert _row(container, newer)["claimed"] == 0


def test_claim_skips_a_recording_another_claimer_won(container: Container) -> None:
    first = _queue(container, created_at=T0)
    second = _queue(container, created_at=T1)
    raced: list[str] = []

    with closing(connect(container.db_path)) as conn, closing(connect(container.db_path)) as rival:

        def claim_first_when_claim_begins(statement: str) -> None:
            # The rival commits its claim after the candidates were read but before this claim's UPDATE runs.
            if statement.startswith("BEGIN") and not raced:
                raced.append(statement)
                with rival:
                    rival.execute("UPDATE recordings SET claimed = 1 WHERE id = ?", (first,))

        conn.set_trace_callback(claim_first_when_claim_begins)
        assert claim_next(conn) == second
        conn.set_trace_callback(None)

    assert raced
    assert _row(container, second)["claimed"] == 1


def test_claim_returns_none_when_the_only_candidate_was_taken(container: Container) -> None:
    only = _queue(container)

    with closing(connect(container.db_path)) as conn, closing(connect(container.db_path)) as rival:

        def claim_when_claim_begins(statement: str) -> None:
            if statement.startswith("BEGIN"):
                with rival:
                    rival.execute("UPDATE recordings SET claimed = 1 WHERE id = ?", (only,))

        conn.set_trace_callback(claim_when_claim_begins)
        assert claim_next(conn) is None
        conn.set_trace_callback(None)


def test_recover_on_startup_clears_every_claim(container: Container) -> None:
    ids = [_queue(container, claimed=True), _queue(container, status="diarizing", claimed=True)]

    with closing(connect(container.db_path)) as conn:
        recover_on_startup(conn)
        assert not conn.in_transaction

    assert [_row(container, rec_id)["claimed"] for rec_id in ids] == [0, 0]


def test_run_once_returns_false_when_queue_empty(container: Container) -> None:
    _queue(container, status="ready")

    assert Worker(container).run_once() is False


def test_one_failure_does_not_stop_the_queue(container: Container) -> None:
    broken = _queue(container, created_at=T0, audio=b"this is not audio" * 100)
    good = _queue(container, created_at=T1)
    worker = Worker(container)

    assert worker.run_once() is True
    assert _row(container, broken) == {"status": "failed", "claimed": 0, "error_code": "audio_unreadable"}
    assert worker.run_once() is True
    assert _row(container, good) == {"status": "ready", "claimed": 0, "error_code": None}
    assert worker.run_once() is False


@pytest.mark.parametrize("blocked", ["transcribing", "diarizing"])
def test_worker_holds_no_write_lock_during_slow_step(
    container: Container, client: TestClient, blocked: Literal["transcribing", "diarizing"]
) -> None:
    claimed = _queue(container, created_at=T0)
    other = _queue(container, status="ready", created_at=T1)
    speech = BlockingSpeech(blocked)
    worker = Worker(dataclasses.replace(container, asr=speech, diarizer=speech))

    with _running(worker.run_once) as errors:
        try:
            assert speech.entered.wait(timeout=WAIT_S)
            assert _row(container, claimed)["status"] == blocked
            started = time.monotonic()
            other_response = client.delete(f"/api/v1/recordings/{other}")
            other_elapsed = time.monotonic() - started
            started = time.monotonic()
            busy_response = client.delete(f"/api/v1/recordings/{claimed}")
            busy_elapsed = time.monotonic() - started
        finally:
            speech.release.set()

    assert errors == []
    assert other_response.status_code == 204
    assert other_elapsed < 1.0
    assert busy_response.status_code == 409
    assert busy_response.json()["error"]["code"] == "recording_busy"
    assert busy_elapsed < 1.0
    assert _row(container, claimed)["status"] == "ready"
    assert _execute(container, "SELECT 1 FROM recordings WHERE id = ?", (other,)) == []


def test_start_recovers_claims_and_processes_the_queue(container: Container) -> None:
    # Claimed by a previous server run that stopped mid-way.
    rec_id = _queue(container, claimed=True)
    asr = SignallingAsr()
    worker = Worker(dataclasses.replace(container, asr=asr))

    worker.start()
    try:
        assert asr.called.wait(timeout=WAIT_S)
    finally:
        worker.stop()

    assert _row(container, rec_id) == {"status": "ready", "claimed": 0, "error_code": None}


def test_stop_returns_promptly_when_idle(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    found_empty = _signal_empty_claims(monkeypatch)
    worker = Worker(container)
    worker.start()
    assert found_empty.wait(timeout=WAIT_S)

    started = time.monotonic()
    worker.stop()

    assert time.monotonic() - started < 2.0
    assert "processing-worker" not in {thread.name for thread in threading.enumerate()}


def test_worker_thread_survives_an_unexpected_error(container: Container) -> None:
    rec_id = _queue(container)
    _execute(
        container,
        "CREATE TRIGGER block_claim BEFORE UPDATE OF claimed ON recordings WHEN NEW.claimed = 1 "
        "BEGIN SELECT RAISE(ABORT, 'blocked'); END",
    )
    asr = SignallingAsr()
    worker = Worker(dataclasses.replace(container, asr=asr))
    handler = SignallingHandler()
    worker_logger = logging.getLogger("app.processing.worker")
    worker_logger.addHandler(handler)

    worker.start()
    try:
        assert handler.emitted.wait(timeout=WAIT_S)
        _execute(container, "DROP TRIGGER block_claim")
        worker.wake()
        assert asr.called.wait(timeout=WAIT_S)
    finally:
        worker.stop()
        worker_logger.removeHandler(handler)

    assert _row(container, rec_id)["status"] == "ready"


def test_wake_worker_without_a_worker_does_nothing(container: Container) -> None:
    assert container.worker is None

    wake_worker(container)


def test_app_without_worker_starts_nothing(container: Container) -> None:
    with TestClient(create_app(container)):
        assert container.worker is None
        assert "processing-worker" not in {thread.name for thread in threading.enumerate()}


def test_app_with_worker_processes_an_upload_on_wake(
    container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    found_empty = _signal_empty_claims(monkeypatch)
    asr = SignallingAsr()
    served = dataclasses.replace(container, asr=asr)

    with TestClient(create_app(served, start_worker=True)) as client:
        assert served.worker is not None
        # The idle wait is far longer than WAIT_S, so from here only the upload's wake gets the worker going.
        assert found_empty.wait(timeout=WAIT_S)
        response = client.post(
            "/api/v1/recordings",
            data={"kind": "meeting", "client_upload_id": "upload-1"},
            files={"file": ("voice.wav", sine_wav(tmp_path / "voice.wav").read_bytes(), "application/octet-stream")},
        )
        assert response.status_code == 201
        assert asr.called.wait(timeout=WAIT_S)

    # Shutdown joined the worker, so the recording it was processing is finished.
    assert served.worker is None
    assert _row(container, response.json()["id"])["status"] == "ready"
