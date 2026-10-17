import dataclasses
import json
import logging
import sqlite3
from collections.abc import Sequence
from contextlib import closing
from pathlib import Path

import pytest

from app.agents.schemas import MeetingAnalysis, NoteAnalysis
from app.api.errors import ErrorCode
from app.audio.decode import AudioUnreadable, DecodedAudio, decode_to_npy
from app.audio.storage import audio_path, tmp_dir
from app.container import Container
from app.db.connection import connect
from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.types import RecordingKind, RecordingStatus
from app.processing.fakes import FakeAnalyzer
from app.processing.pipeline import StepError, process_recording
from app.processing.protocols import AnalysisRequest
from app.processing.worker import Worker, recover_on_startup
from app.recordings.edit import retry_recording
from app.speech.fakes import FakeDiarizer
from app.speech.protocols import AsrSegment, DiarTurn
from tests.fixtures.audio_gen import sine_m4a
from tests.seed import seed_recording

SENTINEL_PEAKS = [0.25] * 96


class SilentAsr:
    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        return []


class SpyAnalyzer:
    def __init__(self) -> None:
        self.requests: list[AnalysisRequest] = []

    def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis:
        self.requests.append(request)
        return FakeAnalyzer().analyze(request)


class RaisingDiarizer:
    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        raise RuntimeError("private-value")


class LitteringDiarizer:
    """Leaves an extra file next to the decoded audio, as a speech child process may, then fails or succeeds."""

    def __init__(self, *, fail: bool) -> None:
        self.fail = fail

    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        (audio_npy.parent / "child-output.json").write_text("{}", encoding="utf-8")
        if self.fail:
            raise RuntimeError("diarizer crashed")
        return FakeDiarizer().diarize(audio_npy)


class EmptyDiarizer:
    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        return []


class StepErrorAsr:
    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        raise StepError(ErrorCode.transcription_failed, "The speech model is not installed.")


class RecordingDiarizer:
    """Notes whether the decoded audio existed when the diarizer was asked to read it."""

    def __init__(self) -> None:
        self.saw_audio: list[bool] = []

    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        self.saw_audio.append(audio_npy.is_file())
        return FakeDiarizer().diarize(audio_npy)


def _queue(
    container: Container,
    *,
    kind: RecordingKind = "meeting",
    status: RecordingStatus = "uploaded",
    created_at: str | None = None,
    audio: bytes | None = None,
) -> str:
    """A recording as an upload leaves it: audio on disk, no duration, no peaks, no transcript."""
    with closing(connect(container.db_path)) as conn:
        rec_id = seed_recording(conn, kind=kind, status=status, title=None, segments=(), created_at=created_at)
        with conn:
            conn.execute("UPDATE recordings SET duration_ms = NULL WHERE id = ?", (rec_id,))
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


def _recording(container: Container, rec_id: str) -> dict[str, object]:
    return _execute(container, "SELECT * FROM recordings WHERE id = ?", (rec_id,))[0]


_COUNT_SQL = {
    "segments": "SELECT COUNT(*) AS n FROM segments WHERE recording_id = ?",
    "speakers": "SELECT COUNT(*) AS n FROM speakers WHERE recording_id = ?",
    "recording_tags": "SELECT COUNT(*) AS n FROM recording_tags WHERE recording_id = ?",
}

# The analyze and index steps only move the status in this task, so blocking that move is how they fail.
_BLOCK_STATUS_SQL = {
    "indexing": "CREATE TRIGGER block_step BEFORE UPDATE OF status ON recordings WHEN NEW.status = 'indexing' "
    "BEGIN SELECT RAISE(ABORT, 'blocked'); END",
    "ready": "CREATE TRIGGER block_step BEFORE UPDATE OF status ON recordings WHEN NEW.status = 'ready' "
    "BEGIN SELECT RAISE(ABORT, 'blocked'); END",
}


def _count(container: Container, table: str, rec_id: str) -> int:
    count = _execute(container, _COUNT_SQL[table], (rec_id,))[0]["n"]
    assert isinstance(count, int)
    return count


def _tmp(container: Container, rec_id: str) -> Path:
    return tmp_dir(container.settings.data_dir, rec_id)


def _run(container: Container) -> None:
    assert Worker(container).run_once()


def test_meeting_reaches_ready_with_speakers_and_segments(container: Container) -> None:
    rec_id = _queue(container)

    _run(container)

    row = _recording(container, rec_id)
    assert row["status"] == "ready"
    assert row["claimed"] == 0
    assert isinstance(row["duration_ms"], int) and 1900 <= row["duration_ms"] <= 2100
    peaks = json.loads(str(row["waveform_peaks"]))
    assert len(peaks) == 96 and max(peaks) == 1.0
    segments = _execute(
        container,
        "SELECT s.idx, s.text, sp.label FROM segments s LEFT JOIN speakers sp ON sp.id = s.speaker_id "
        "WHERE s.recording_id = ? ORDER BY s.idx",
        (rec_id,),
    )
    assert [segment["idx"] for segment in segments] == list(range(6))
    assert [segment["label"] for segment in segments] == ["A", "B", "A", "B", "A", "B"]
    assert segments[0]["text"] == "Let's discuss the demo plan."
    assert _count(container, "speakers", rec_id) == 2
    assert not _tmp(container, rec_id).exists()


def test_note_skips_diarize(container: Container) -> None:
    diarizer = RecordingDiarizer()
    rec_id = _queue(container, kind="note")

    _run(dataclasses.replace(container, diarizer=diarizer))

    assert _recording(container, rec_id)["status"] == "ready"
    assert diarizer.saw_audio == []
    assert _count(container, "segments", rec_id) == 6
    assert _count(container, "speakers", rec_id) == 0
    assert (
        _execute(container, "SELECT 1 FROM segments WHERE recording_id = ? AND speaker_id IS NOT NULL", (rec_id,)) == []
    )


@pytest.mark.parametrize(
    ("kind", "empty"),
    [
        ("meeting", MeetingSummary(overview="", decisions=[], action_items=[], open_questions=[])),
        ("note", NoteContent(key_points=[], clean_text="")),
    ],
)
def test_silent_recording_ready_untitled_without_analyzer_call(
    container: Container, kind: RecordingKind, empty: MeetingSummary | NoteContent
) -> None:
    analyzer = SpyAnalyzer()
    diarizer = RecordingDiarizer()
    rec_id = _queue(container, kind=kind)
    with closing(connect(container.db_path)) as conn:
        tagged = seed_recording(conn, tags=["budget"])
    _execute(
        container,
        "INSERT INTO recording_tags SELECT ?, tag_id FROM recording_tags WHERE recording_id = ?",
        (rec_id, tagged),
    )

    _run(dataclasses.replace(container, asr=SilentAsr(), diarizer=diarizer, analyzer=analyzer))

    row = _recording(container, rec_id)
    assert row["status"] == "ready"
    assert row["claimed"] == 0
    assert row["title"] == "Untitled recording"
    assert json.loads(str(row["analysis"])) == empty.model_dump(mode="json")
    assert _count(container, "recording_tags", rec_id) == 0
    assert _count(container, "segments", rec_id) == 0
    # Nothing calls the analyzer before Task 5; this guards the silent path once it does.
    assert analyzer.requests == []
    assert diarizer.saw_audio == []
    assert not _tmp(container, rec_id).exists()


def test_resume_at_diarizing_after_restart_redecodes(container: Container) -> None:
    clean = _queue(container, created_at="2026-10-17T00:00:00Z")
    _run(container)
    resumed = _queue(container, created_at="2026-10-17T00:00:01Z")
    _run(container)
    # A restart during diarizing: still claimed, the decoded audio gone, peaks stored by the first decode.
    _execute(
        container,
        "UPDATE recordings SET status = 'diarizing', claimed = 1, waveform_peaks = ? WHERE id = ?",
        (json.dumps(SENTINEL_PEAKS), resumed),
    )
    assert not _tmp(container, resumed).exists()
    diarizer = RecordingDiarizer()

    with closing(connect(container.db_path)) as conn:
        recover_on_startup(conn)
    _run(dataclasses.replace(container, diarizer=diarizer))

    row = _recording(container, resumed)
    assert row["status"] == "ready"
    assert row["claimed"] == 0
    assert diarizer.saw_audio == [True]
    assert json.loads(str(row["waveform_peaks"])) == SENTINEL_PEAKS
    for table in ("segments", "speakers"):
        assert _count(container, table, resumed) == _count(container, table, clean)
    assert not _tmp(container, resumed).exists()


def test_resume_at_transcribing_with_null_peaks_decodes_and_stores_them(container: Container) -> None:
    # A restart between "transcribing" being set and the decode result being stored.
    rec_id = _queue(container, status="transcribing")
    _execute(container, "UPDATE recordings SET claimed = 1 WHERE id = ?", (rec_id,))

    with closing(connect(container.db_path)) as conn:
        recover_on_startup(conn)
    _run(container)

    row = _recording(container, rec_id)
    assert row["status"] == "ready"
    assert isinstance(row["duration_ms"], int) and row["duration_ms"] > 0
    assert len(json.loads(str(row["waveform_peaks"]))) == 96


def test_rerunning_transcribe_does_not_duplicate_output(container: Container) -> None:
    rec_id = _queue(container)
    _run(container)
    _execute(container, "UPDATE recordings SET status = 'transcribing' WHERE id = ?", (rec_id,))

    _run(container)

    assert _recording(container, rec_id)["status"] == "ready"
    assert _count(container, "segments", rec_id) == 6
    assert _count(container, "speakers", rec_id) == 2


def test_step_failure_sets_failed_step_and_code(container: Container, caplog: pytest.LogCaptureFixture) -> None:
    rec_id = _queue(container)

    with caplog.at_level(logging.ERROR):
        _run(dataclasses.replace(container, diarizer=RaisingDiarizer()))

    row = _recording(container, rec_id)
    assert row["status"] == "failed"
    assert row["failed_step"] == "diarizing"
    assert row["error_code"] == "diarization_failed"
    assert row["claimed"] == 0
    assert isinstance(row["error_message"], str) and row["error_message"]
    assert "private-value" not in row["error_message"]
    assert "RuntimeError" in caplog.text and "diarizing" in caplog.text
    assert "private-value" not in caplog.text
    assert not _tmp(container, rec_id).exists()
    # Diarization failure fails the meeting: the transcript is kept, but no speaker was invented.
    assert _count(container, "speakers", rec_id) == 0

    with closing(connect(container.db_path)) as conn:
        retry_recording(conn, rec_id)
    _run(container)

    row = _recording(container, rec_id)
    assert row["status"] == "ready"
    assert row["failed_step"] is None and row["error_code"] is None and row["error_message"] is None
    assert _count(container, "segments", rec_id) == 6
    assert _count(container, "speakers", rec_id) == 2


def test_unreadable_audio_fails_at_decoding(container: Container) -> None:
    rec_id = _queue(container, audio=b"this is not audio" * 100)

    _run(container)

    row = _recording(container, rec_id)
    assert (row["status"], row["failed_step"], row["error_code"]) == ("failed", "decoding", "audio_unreadable")
    assert row["claimed"] == 0
    assert not _tmp(container, rec_id).exists()


def test_step_error_keeps_its_code_and_message(container: Container) -> None:
    rec_id = _queue(container)

    _run(dataclasses.replace(container, asr=StepErrorAsr()))

    row = _recording(container, rec_id)
    assert (row["status"], row["failed_step"], row["error_code"]) == ("failed", "transcribing", "transcription_failed")
    assert row["error_message"] == "The speech model is not installed."


def test_empty_diarization_fails_the_meeting(container: Container) -> None:
    rec_id = _queue(container)

    _run(dataclasses.replace(container, diarizer=EmptyDiarizer()))

    row = _recording(container, rec_id)
    assert (row["status"], row["failed_step"], row["error_code"]) == ("failed", "diarizing", "diarization_failed")


@pytest.mark.parametrize(
    ("blocked_status", "failed_step", "code"),
    [("indexing", "analyzing", "analysis_failed"), ("ready", "indexing", "indexing_failed")],
)
def test_analyze_and_index_failures_are_recorded(
    container: Container, blocked_status: str, failed_step: str, code: str
) -> None:
    rec_id = _queue(container)
    _execute(container, _BLOCK_STATUS_SQL[blocked_status])

    _run(container)

    row = _recording(container, rec_id)
    assert (row["status"], row["failed_step"], row["error_code"]) == ("failed", failed_step, code)
    assert row["claimed"] == 0
    assert not _tmp(container, rec_id).exists()


def test_failure_after_restart_redecode_is_a_decoding_failure(container: Container) -> None:
    rec_id = _queue(container, status="diarizing", audio=b"this is not audio" * 100)

    _run(container)

    row = _recording(container, rec_id)
    assert (row["failed_step"], row["error_code"]) == ("decoding", "audio_unreadable")


def test_process_recording_leaves_no_transaction_open(container: Container) -> None:
    rec_id = _queue(container)
    with closing(connect(container.db_path)) as conn:
        process_recording(container, conn, rec_id)
        assert not conn.in_transaction
    assert _recording(container, rec_id)["status"] == "ready"


def test_tmp_dir_with_extra_files_is_removed_when_ready(container: Container) -> None:
    rec_id = _queue(container)

    _run(dataclasses.replace(container, diarizer=LitteringDiarizer(fail=False)))

    assert _recording(container, rec_id)["status"] == "ready"
    assert not _tmp(container, rec_id).exists()


def test_tmp_dir_is_removed_even_when_recording_the_failure_fails(container: Container) -> None:
    rec_id = _queue(container)
    _execute(container, "UPDATE recordings SET claimed = 1 WHERE id = ?", (rec_id,))
    _execute(
        container,
        "CREATE TRIGGER block_failed BEFORE UPDATE OF status ON recordings WHEN NEW.status = 'failed' "
        "BEGIN SELECT RAISE(ABORT, 'blocked'); END",
    )
    failing = dataclasses.replace(container, diarizer=LitteringDiarizer(fail=True))

    with closing(connect(container.db_path)) as conn, pytest.raises(sqlite3.IntegrityError):
        process_recording(failing, conn, rec_id)

    assert not _tmp(container, rec_id).exists()
    assert _recording(container, rec_id)["status"] == "diarizing"


def test_decode_dying_mid_write_never_leaves_a_partial_audio_npy(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A re-decode after a restart: peaks are stored, so a truncated audio.npy would be trusted by the next resume.
    rec_id = _queue(container, status="diarizing")
    _execute(container, "UPDATE recordings SET duration_ms = 2000, waveform_peaks = ? WHERE id = ?", ("[0.5]", rec_id))
    npy = _tmp(container, rec_id) / "audio.npy"
    left_on_crash: list[bool] = []

    def write_partly_then_die(src: Path, dest: Path) -> DecodedAudio:
        decode_to_npy(src, dest)
        dest.write_bytes(dest.read_bytes()[:64])
        # What a process killed right now would leave behind.
        left_on_crash.append(npy.exists())
        raise AudioUnreadable("The audio could not be decoded.")

    monkeypatch.setattr("app.processing.pipeline.decode_to_npy", write_partly_then_die)

    _run(container)

    assert left_on_crash == [False]
    assert not _tmp(container, rec_id).exists()
    row = _recording(container, rec_id)
    assert (row["status"], row["failed_step"], row["error_code"]) == ("failed", "decoding", "audio_unreadable")


def test_successful_decode_leaves_only_audio_npy(container: Container) -> None:
    seen: list[list[str]] = []

    class ListingAsr:
        def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
            seen.append(sorted(path.name for path in audio_npy.parent.iterdir()))
            return []

    _queue(container)

    _run(dataclasses.replace(container, asr=ListingAsr()))

    assert seen == [["audio.npy"]]
