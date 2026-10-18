import dataclasses
import json
from pathlib import Path
from typing import cast

import pytest

from app.cli import main
from app.config.app_config import AppConfig
from app.config.settings import Settings
from app.container import Container
from app.container import build_container as real_build_container
from app.db.connection import connect
from app.domain.analysis import MeetingSummary, NoteContent
from app.processing.fakes import FakeAnalyzer
from app.rag.fakes import FakeEmbedder
from app.rag.vectors import unpack_embedding


def build_with_fakes(settings: Settings) -> Container:
    result = dataclasses.replace(
        real_build_container(settings), embedder=FakeEmbedder(), analyzer=FakeAnalyzer(), chat_runs=None
    )
    from app.agents.chat_graph import build_chat_graph
    from app.chats.runs import ChatRuns

    # Chat runs hold their container, so they are rebuilt on the one carrying the fakes.
    result.chat_runs = ChatRuns(result, build_chat_graph)
    return result


@pytest.fixture
def cli_container(container: Container, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Container:
    container.settings.data_dir = tmp_path / "cli-data"
    container.settings.bind_host = "127.0.0.1"
    container.settings.port = 8123

    def isolated_settings(app: AppConfig) -> Settings:
        return container.settings

    monkeypatch.setattr("app.cli.load_settings", isolated_settings)
    monkeypatch.setattr("app.cli.build_container", build_with_fakes)
    return container


def test_seed_demo_inserts_two_ready_recordings(cli_container: Container) -> None:
    main(["seed-demo"])

    conn = connect(cli_container.settings.data_dir / "app.db")
    try:
        rows = conn.execute("SELECT * FROM recordings ORDER BY kind").fetchall()
        assert len(rows) == 2

        # 1. Ready meeting
        meeting = rows[0] if rows[0]["kind"] == "meeting" else rows[1]
        assert meeting["status"] == "ready"
        assert meeting["waveform_peaks"] is not None
        peaks = cast(list[float], json.loads(meeting["waveform_peaks"]))
        assert len(peaks) == 96
        assert all(0.0 <= p <= 1.0 for p in peaks)

        # Summary structure: 1 decision, 1 action item with owner, 1 open question, each cited
        assert meeting["analysis"] is not None
        summary = MeetingSummary.model_validate_json(meeting["analysis"])
        assert len(summary.decisions) == 1
        assert len(summary.decisions[0].citations) >= 1
        assert len(summary.action_items) == 1
        assert summary.action_items[0].owner_speaker_id is not None
        assert len(summary.action_items[0].citations) >= 1
        assert len(summary.open_questions) == 1
        assert len(summary.open_questions[0].citations) >= 1

        # Two speakers
        speakers = conn.execute("SELECT * FROM speakers WHERE recording_id = ?", (meeting["id"],)).fetchall()
        assert len(speakers) == 2

        # ~8 segments (between 6 and 10)
        segments = conn.execute(
            "SELECT * FROM segments WHERE recording_id = ? ORDER BY idx", (meeting["id"],)
        ).fetchall()
        assert 6 <= len(segments) <= 10

        # Meeting chunks with embeddings
        m_chunks = conn.execute("SELECT * FROM chunks WHERE recording_id = ?", (meeting["id"],)).fetchall()
        assert len(m_chunks) >= 1
        for chk in m_chunks:
            vec = unpack_embedding(chk["embedding"])
            assert len(vec) == 384
            # Chunking rule: one line per segment, labelled by speaker label, never by name.
            for line in str(chk["text"]).splitlines():
                assert line.startswith(("Speaker A: ", "Speaker B: "))
                assert "Sarah" not in line
                assert "Alex" not in line

        # 2. Ready note
        note = rows[0] if rows[0]["kind"] == "note" else rows[1]
        assert note["status"] == "ready"
        assert note["waveform_peaks"] is not None
        note_peaks = cast(list[float], json.loads(note["waveform_peaks"]))
        assert len(note_peaks) == 96
        assert all(0.0 <= p <= 1.0 for p in note_peaks)

        # Note structure: 3 key points, clean note
        assert note["analysis"] is not None
        note_content = NoteContent.model_validate_json(note["analysis"])
        assert len(note_content.key_points) == 3
        for kp in note_content.key_points:
            assert len(kp.citations) >= 1
        assert len(note_content.clean_text) > 0
        # Clean text is tidy prose, not markdown.
        for line in note_content.clean_text.splitlines():
            assert not line.lstrip().startswith(("#", "-"))

        # Note chunks with embeddings
        n_chunks = conn.execute("SELECT * FROM chunks WHERE recording_id = ?", (note["id"],)).fetchall()
        assert len(n_chunks) >= 1
        for chk in n_chunks:
            vec = unpack_embedding(chk["embedding"])
            assert len(vec) == 384
    finally:
        conn.close()


def test_seed_demo_refuses_when_recordings_exist(cli_container: Container, capsys: pytest.CaptureFixture[str]) -> None:
    main(["seed-demo"])

    with pytest.raises(SystemExit) as exc_info:
        main(["seed-demo"])
    assert exc_info.value.code == 1

    captured = capsys.readouterr()
    assert "refuse" in captured.err.lower() or "already exist" in captured.err.lower()
