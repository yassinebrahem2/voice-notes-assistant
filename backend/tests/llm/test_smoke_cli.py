import io
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import httpx2 as httpx
import pytest
from langchain_core.messages import AIMessage
from pydantic import HttpUrl, TypeAdapter

from app.agents.schemas import ChatReply, Item, NoteAnalysis
from app.cli import main
from app.config.app_config import AppConfig
from app.config.models_registry import LlmEntry, LocalModel, ModelsRegistry, Provider, Roles
from app.config.settings import Settings
from app.container import Container
from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.llm.smoke import run_smoke_tests
from app.rag.calibrate import CalibrationResult, calibrate_retrieval, run_calibration
from app.rag.fakes import FakeEmbedder
from tests.agents.fake_models import ScriptedChatModel
from tests.seed import seed_chunk, seed_recording


def make_test_registry(
    groq_models: list[str] | None = None,
    gemini_models: list[str] | None = None,
) -> ModelsRegistry:
    url_adapter = TypeAdapter(HttpUrl)
    g_models = groq_models or ["openai/gpt-oss-20b"]
    gem_models = gemini_models or ["gemini-flash-latest"]
    return ModelsRegistry(
        providers={
            "groq": Provider(
                base_url=url_adapter.validate_python("https://api.groq.com/openai/v1"),
                key_env="GROQ_API_KEY",
            ),
            "gemini": Provider(
                base_url=url_adapter.validate_python("https://generativelanguage.googleapis.com/v1beta/openai/"),
                key_env="GEMINI_API_KEY",
            ),
        },
        roles=Roles(
            llm=[
                LlmEntry(
                    provider="groq",
                    model=g_models[0],
                    max_request_tokens=8192,
                    timeout_s=30.0,
                )
            ],
            llm_analysis=[
                LlmEntry(
                    provider="gemini",
                    model=gem_models[0],
                    max_request_tokens=32768,
                    timeout_s=60.0,
                )
            ],
            embedder=LocalModel(model="BAAI/bge-small-en-v1.5", device="cpu"),
            asr=LocalModel(model="distil-large-v3", device="cuda"),
            diarizer=LocalModel(model="pyannote/speaker-diarization-community-1", device="cuda"),
        ),
    )


def test_cli_argument_parsing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    smoke_called = False
    calibrate_path: Path | None = None

    def fake_smoke(container: Container, *, out_stream: Any = None) -> int:
        nonlocal smoke_called
        smoke_called = True
        return 0

    def fake_calibrate(container: Container, questions_path: Path, *, out_stream: Any = None) -> int:
        nonlocal calibrate_path
        calibrate_path = questions_path
        return 0

    monkeypatch.setattr("app.llm.smoke.run_smoke_tests", fake_smoke)
    monkeypatch.setattr("app.rag.calibrate.run_calibration", fake_calibrate)

    def isolated_settings(app: AppConfig) -> Settings:
        s = Settings()
        s.data_dir = tmp_path
        return s

    monkeypatch.setattr("app.cli.load_settings", isolated_settings)

    # Test smoke-llm command
    main(["smoke-llm"])
    assert smoke_called is True

    # Test calibrate-retrieval command
    q_file = tmp_path / "questions.yaml"
    q_file.write_text("questions: []\n", encoding="utf-8")
    main(["calibrate-retrieval", "--questions", str(q_file)])
    assert calibrate_path == q_file

    # Test missing --questions raises SystemExit
    with pytest.raises(SystemExit):
        main(["calibrate-retrieval"])


def test_smoke_provider_models_check_success_and_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    monkeypatch.setenv("GROQ_API_KEY", "dummy-groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")

    def fake_get(url: str, headers: dict[str, str], timeout: float) -> httpx.Response:
        req = httpx.Request("GET", url, headers=headers)
        if "groq" in url:
            return httpx.Response(200, request=req, json={"data": [{"id": "openai/gpt-oss-20b"}]})
        if "generativelanguage" in url:
            # Missing the configured gemini-flash-latest model
            return httpx.Response(200, request=req, json={"data": [{"id": "other-model"}]})
        return httpx.Response(404, request=req)

    mock_client = MagicMock()
    mock_client.get.side_effect = fake_get

    out = io.StringIO()

    # Mock role checks so we isolate the provider models check
    def mock_llm_entry(
        entry: LlmEntry, registry: ModelsRegistry, *, check_type: str
    ) -> tuple[bool, str, dict[str, int]]:
        return (True, "mocked", {})

    def mock_analysis_entry(entry: LlmEntry, registry: ModelsRegistry) -> tuple[bool, str, dict[str, int]]:
        return (True, "mocked", {})

    monkeypatch.setattr("app.llm.smoke._check_llm_entry", mock_llm_entry)
    monkeypatch.setattr("app.llm.smoke._check_analysis_entry", mock_analysis_entry)

    exit_code = run_smoke_tests(registry, client=mock_client, out_stream=out)
    output = out.getvalue()

    assert exit_code == 1
    assert "[PASS] groq: model 'openai/gpt-oss-20b' exists" in output
    assert "[FAIL] gemini: model 'gemini-flash-latest' not found" in output


def test_smoke_provider_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    out = io.StringIO()

    def mock_llm_entry_missing(
        entry: LlmEntry, registry: ModelsRegistry, *, check_type: str
    ) -> tuple[bool, str, dict[str, int]]:
        return (True, "mocked", {})

    def mock_analysis_entry_missing(entry: LlmEntry, registry: ModelsRegistry) -> tuple[bool, str, dict[str, int]]:
        return (True, "mocked", {})

    monkeypatch.setattr("app.llm.smoke._check_llm_entry", mock_llm_entry_missing)
    monkeypatch.setattr("app.llm.smoke._check_analysis_entry", mock_analysis_entry_missing)

    exit_code = run_smoke_tests(registry, out_stream=out)
    output = out.getvalue()

    assert exit_code == 1
    assert "Missing GROQ_API_KEY" in output or "missing API key in GROQ_API_KEY" in output.lower()


def test_smoke_llm_entry_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    monkeypatch.setenv("GROQ_API_KEY", "dummy-groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")

    mock_client = MagicMock()
    mock_client.get.return_value = httpx.Response(
        200,
        request=httpx.Request("GET", "https://api.openai.com/v1/models"),
        json={"data": [{"id": "openai/gpt-oss-20b"}, {"id": "gemini-flash-latest"}]},
    )

    # Orchestrator tool turn returns search_transcripts tool call
    tool_turn_msg = AIMessage(
        content="",
        tool_calls=[{"name": "search_transcripts", "args": {"query": "project status"}, "id": "call_1"}],
        usage_metadata={"input_tokens": 40, "output_tokens": 15, "total_tokens": 55},
    )

    # Forced final turn returns ChatReply tool call
    final_turn_msg = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "ChatReply",
                "args": ChatReply(reply_type="answer", text="Project status update [P1]").model_dump(),
                "id": "call_2",
            }
        ],
        usage_metadata={"input_tokens": 65, "output_tokens": 20, "total_tokens": 85},
    )

    # Summarizer turn returns NoteAnalysis
    analysis_msg = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "NoteAnalysis",
                "args": NoteAnalysis(
                    title="Standup Update",
                    tags=["standup"],
                    key_points=[Item(text="Launch on track", sources=[1])],
                    clean_text="Clean note text",
                ).model_dump(),
                "id": "call_3",
            }
        ],
        usage_metadata={"input_tokens": 120, "output_tokens": 50, "total_tokens": 170},
    )

    call_index = 0
    messages = [tool_turn_msg, final_turn_msg, analysis_msg]

    def fake_chat_model(entry: LlmEntry, reg: ModelsRegistry) -> ScriptedChatModel:
        nonlocal call_index
        msg = messages[call_index % len(messages)]
        call_index += 1
        return ScriptedChatModel(messages=iter([msg]))

    monkeypatch.setattr("app.llm.smoke.chat_model", fake_chat_model)
    monkeypatch.setattr("app.llm.factory.chat_model", fake_chat_model)

    out = io.StringIO()
    exit_code = run_smoke_tests(registry, client=mock_client, out_stream=out)
    output = out.getvalue()

    assert exit_code == 0
    assert "[PASS]" in output
    assert "tool call: called 'search_transcripts'" in output
    assert "forced final turn: called 'ChatReply'" in output
    assert "summarizer: produced NoteAnalysis 'Standup Update'" in output
    assert "tokens:" in output


def test_smoke_llm_never_prints_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel = "DUMMY_SENSITIVE_SENTINEL_VAL_XYZZY_9999"
    monkeypatch.setenv("GROQ_API_KEY", sentinel)
    monkeypatch.setenv("GEMINI_API_KEY", sentinel)

    registry = make_test_registry()
    mock_client = MagicMock()
    mock_client.get.side_effect = RuntimeError("Failed connection with key leak attempt")

    out = io.StringIO()
    run_smoke_tests(registry, client=mock_client, out_stream=out)
    output = out.getvalue()

    assert sentinel not in output


def test_calibrate_retrieval_clean_margin(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()

        # Seed recording 1
        v1 = embedder.embed_query("Architecture notes on vector database")
        rec1 = seed_recording(conn, kind="note", title="Architecture Decisions")
        seed_chunk(conn, rec1, first_idx=0, last_idx=0, text="Vector DB architecture", vector=v1)

        # Seed recording 2
        v2 = embedder.embed_query("Weekly team sync meeting")
        rec2 = seed_recording(conn, kind="meeting", title="Weekly Sync")
        seed_chunk(conn, rec2, first_idx=0, last_idx=0, text="Team sync details", vector=v2)

        # Questions file
        yaml_content = """
questions:
  - text: "Architecture notes on vector database"
    expect_recording_title: "Architecture Decisions"
  - text: "What is the recipe for chocolate cake?"
    unrelated: true
"""
        q_file = tmp_path / "questions.yaml"
        q_file.write_text(yaml_content, encoding="utf-8")

        result = calibrate_retrieval(conn, embedder, q_file)
        assert isinstance(result, CalibrationResult)
        assert result.has_overlap is False
        assert result.max_expected_distance < result.min_unrelated_distance
        assert result.suggested_threshold == round(
            (result.max_expected_distance + result.min_unrelated_distance) / 2.0, 3
        )

        out = io.StringIO()
        exit_code = run_calibration(conn, embedder, q_file, out_stream=out)
        output = out.getvalue()
        assert exit_code == 0
        assert "Clean separation with margin" in output
        assert f"Suggested retrieval_max_distance: {result.suggested_threshold:.3f}" in output
    finally:
        conn.close()


def test_calibrate_retrieval_overlap(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()

        v1 = embedder.embed_query("Architecture notes")
        rec1 = seed_recording(conn, kind="note", title="Architecture Decisions")
        seed_chunk(conn, rec1, first_idx=0, last_idx=0, text="Architecture notes", vector=v1)

        # An unrelated query that is artificially very close, and an expected query that is far
        yaml_content = """
questions:
  - text: "Completely unrelated topic about gardening flowers"
    expect_recording_title: "Architecture Decisions"
  - text: "Architecture notes"
    unrelated: true
"""
        q_file = tmp_path / "questions.yaml"
        q_file.write_text(yaml_content, encoding="utf-8")

        result = calibrate_retrieval(conn, embedder, q_file)
        assert result.has_overlap is True

        out = io.StringIO()
        exit_code = run_calibration(conn, embedder, q_file, out_stream=out)
        output = out.getvalue()
        assert exit_code == 0
        assert "Overlap detected" in output
        assert "Recommendation:" in output
    finally:
        conn.close()


def test_calibrate_retrieval_empty_db_or_file_error(tmp_path: Path) -> None:
    conn = connect(tmp_path / "test.sqlite3")
    try:
        apply_migrations(conn)
        embedder = FakeEmbedder()

        # Non-existent file
        out = io.StringIO()
        code = run_calibration(conn, embedder, tmp_path / "nonexistent.yaml", out_stream=out)
        assert code == 1
        assert "Error" in out.getvalue()

        # Empty DB
        q_file = tmp_path / "questions.yaml"
        q_file.write_text("questions: [{text: 'hello', unrelated: true}]\n", encoding="utf-8")
        out2 = io.StringIO()
        code2 = run_calibration(conn, embedder, q_file, out_stream=out2)
        assert code2 == 1
        assert "No ready recording chunks found" in out2.getvalue()
    finally:
        conn.close()
