from pathlib import Path

import httpx2 as httpx
import openai
import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from pydantic import HttpUrl, TypeAdapter

from app.agents.schemas import (
    ActionItem,
    Item,
    MeetingAnalysis,
    NoteAnalysis,
    NoteSectionNotes,
)
from app.agents.summarizer import (
    OUTPUT_ALLOWANCE,
    AnalysisFailed,
    SummarizerAnalyzer,
    estimate_tokens,
)
from app.agents.transcript_input import render_transcript
from app.config.app_config import load_app_config
from app.config.models_registry import LlmEntry, LocalModel, ModelsRegistry, Provider, Roles
from app.config.settings import load_settings
from app.container import Container, build_container
from app.processing.fakes import FakeAnalyzer
from app.processing.protocols import AnalysisRequest, TranscriptLine
from tests.agents.fake_models import FailingChatModel, ScriptedChatModel


def make_test_registry(entries: list[LlmEntry] | None = None) -> ModelsRegistry:
    url_adapter = TypeAdapter(HttpUrl)
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
                    model="openai/gpt-oss-20b",
                    max_request_tokens=8192,
                    timeout_s=30.0,
                )
            ],
            llm_analysis=entries
            if entries is not None
            else [
                LlmEntry(
                    provider="groq",
                    model="openai/gpt-oss-20b",
                    max_request_tokens=8192,
                    timeout_s=30.0,
                )
            ],
            embedder=LocalModel(model="BAAI/bge-small-en-v1.5", device="cpu"),
            asr=LocalModel(model="distil-large-v3", device="cuda"),
            diarizer=LocalModel(model="pyannote/speaker-diarization-community-1", device="cuda"),
        ),
    )


def test_build_container_without_keys_succeeds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("", encoding="utf-8")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("MODEL_CACHE_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("SPEECH_BACKEND", "fake")
    settings = load_settings(load_app_config(), env_file=env_file)

    container = build_container(settings)
    assert isinstance(container.analyzer, SummarizerAnalyzer)


def test_fixture_container_uses_fake_analyzer(container: Container) -> None:
    assert isinstance(container.analyzer, FakeAnalyzer)


def test_short_meeting_one_call() -> None:
    expected = MeetingAnalysis(
        title="Sprint Sync",
        tags=["sprint", "sync"],
        overview="The team discussed the upcoming sprint tasks.",
        decisions=[Item(text="Launch on Friday", sources=[1])],
        action_items=[ActionItem(text="Update tickets", sources=[2], owner="A", due="Thursday")],
        open_questions=[Item(text="Need more testing?", sources=[2])],
    )

    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "MeetingAnalysis",
                            "args": expected.model_dump(),
                            "id": "call_1",
                        }
                    ],
                )
            ]
        )
    )

    registry = make_test_registry(
        [
            LlmEntry(
                provider="groq",
                model="test-model",
                max_request_tokens=10000,
                timeout_s=30.0,
            )
        ]
    )
    analyzer = SummarizerAnalyzer(registry)
    analyzer.models_for_entry = lambda _entry: scripted  # type: ignore[assignment]

    req = AnalysisRequest(
        kind="meeting",
        lines=[
            TranscriptLine(s=1, speaker_label="A", text="Let's launch on Friday."),
            TranscriptLine(
                s=2,
                speaker_label="B",
                text="I will update tickets by Thursday, but do we need more testing?",
            ),
        ],
        tag_vocabulary=["sprint", "planning"],
    )

    result = analyzer.analyze(req)
    assert result == expected
    assert len(scripted.bindings) == 1


def test_long_note_map_reduce_joins_clean_text_in_order() -> None:
    lines = [
        TranscriptLine(s=1, speaker_label=None, text="First section of the note."),
        TranscriptLine(s=2, speaker_label=None, text="Second section of the note."),
        TranscriptLine(s=3, speaker_label=None, text="Third section of the note."),
    ]
    req = AnalysisRequest(kind="note", lines=lines, tag_vocabulary=["notes"])

    # Calculate tokens so each section fits exactly 1 line
    # Render line 1 and line 1+2
    from app.agents.prompts import load_prompt

    map_prompt = load_prompt("summarizer_note_map")
    cost_1 = estimate_tokens(map_prompt + render_transcript(lines[:1]) + "\n\nExisting tags: notes") + OUTPUT_ALLOWANCE
    cost_2 = estimate_tokens(map_prompt + render_transcript(lines[:2]) + "\n\nExisting tags: notes") + OUTPUT_ALLOWANCE
    assert cost_2 > cost_1

    # max_request_tokens = cost_1 ensures 1 line fits, 2 lines do not fit, single call doesn't fit
    budget = cost_1

    section1_notes = NoteSectionNotes(
        key_points=[Item(text="Point 1", sources=[1])],
        clean_text="Part 1 clean text.",
    )
    section2_notes = NoteSectionNotes(
        key_points=[Item(text="Point 2", sources=[2])],
        clean_text="Part 2 clean text.",
    )
    section3_notes = NoteSectionNotes(
        key_points=[Item(text="Point 3", sources=[3])],
        clean_text="Part 3 clean text.",
    )
    reduced_note = NoteAnalysis(
        title="Long Note Summary",
        tags=["notes"],
        key_points=[
            Item(text="Point 1", sources=[1]),
            Item(text="Point 2", sources=[2]),
            Item(text="Point 3", sources=[3]),
        ],
        clean_text="placeholder_from_reduce",
    )

    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "NoteSectionNotes", "args": section1_notes.model_dump(), "id": "m1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "NoteSectionNotes", "args": section2_notes.model_dump(), "id": "m2"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "NoteSectionNotes", "args": section3_notes.model_dump(), "id": "m3"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "NoteAnalysis", "args": reduced_note.model_dump(), "id": "red"}],
                ),
            ]
        )
    )

    registry = make_test_registry(
        [
            LlmEntry(
                provider="groq",
                model="test-model",
                max_request_tokens=budget,
                timeout_s=30.0,
            )
        ]
    )
    analyzer = SummarizerAnalyzer(registry)
    analyzer.models_for_entry = lambda _entry: scripted  # type: ignore[assignment]

    result = analyzer.analyze(req)
    assert isinstance(result, NoteAnalysis)
    assert result.clean_text == "Part 1 clean text.\n\nPart 2 clean text.\n\nPart 3 clean text."
    assert result.title == "Long Note Summary"
    assert len(scripted.bindings) == 4


def test_invalid_output_twice_moves_to_next_entry() -> None:
    # Entry 1 model returns 2 invalid outputs (no tool calls), causing run limit of 2 to hit
    model1 = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(content="I am ignoring the tool call completely."),
                AIMessage(content="Still ignoring the tool call."),
            ]
        )
    )

    expected = MeetingAnalysis(
        title="Sprint Sync",
        tags=["sprint"],
        overview="Overview from second entry.",
        decisions=[],
        action_items=[],
        open_questions=[],
    )
    model2 = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "MeetingAnalysis",
                            "args": expected.model_dump(),
                            "id": "call_2",
                        }
                    ],
                )
            ]
        )
    )

    entry1 = LlmEntry(provider="groq", model="entry-1", max_request_tokens=10000, timeout_s=30.0)
    entry2 = LlmEntry(provider="gemini", model="entry-2", max_request_tokens=10000, timeout_s=30.0)
    registry = make_test_registry([entry1, entry2])

    analyzer = SummarizerAnalyzer(registry)

    def mock_models_for_entry(entry: LlmEntry) -> BaseChatModel:
        if entry.model == "entry-1":
            return model1
        return model2

    analyzer.models_for_entry = mock_models_for_entry  # type: ignore[assignment]

    req = AnalysisRequest(
        kind="meeting",
        lines=[TranscriptLine(s=1, speaker_label="A", text="Meeting segment.")],
        tag_vocabulary=[],
    )

    result = analyzer.analyze(req)
    assert result == expected
    assert len(model1.bindings) == 2
    assert len(model2.bindings) == 1


def test_all_entries_fail_raises_analysis_failed() -> None:
    failing = FailingChatModel(error=RuntimeError("API crashed"))
    entry1 = LlmEntry(provider="groq", model="entry-1", max_request_tokens=10000, timeout_s=30.0)
    registry = make_test_registry([entry1])

    analyzer = SummarizerAnalyzer(registry)
    analyzer.models_for_entry = lambda _entry: failing  # type: ignore[assignment]

    req = AnalysisRequest(
        kind="meeting",
        lines=[TranscriptLine(s=1, speaker_label="A", text="Meeting segment.")],
        tag_vocabulary=[],
    )

    with pytest.raises(AnalysisFailed):
        analyzer.analyze(req)


def test_second_entry_replans_with_its_own_budget() -> None:
    req_http = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    err_500 = openai.InternalServerError(
        message="500 Internal Server Error",
        response=httpx.Response(500, request=req_http),
        body=None,
    )
    # Entry 1 fails with error
    model1 = FailingChatModel(error=err_500)

    lines = [
        TranscriptLine(s=1, speaker_label=None, text="Section 1"),
        TranscriptLine(s=2, speaker_label=None, text="Section 2"),
    ]
    req = AnalysisRequest(kind="note", lines=lines, tag_vocabulary=[])

    from app.agents.prompts import load_prompt

    map_prompt = load_prompt("summarizer_note_map")
    cost_1 = estimate_tokens(map_prompt + render_transcript(lines[:1]) + "\n\nExisting tags: none") + OUTPUT_ALLOWANCE

    # Entry 1 has large budget (would be single call)
    entry1 = LlmEntry(provider="groq", model="entry-1", max_request_tokens=50000, timeout_s=30.0)
    # Entry 2 has small budget (forces map-reduce)
    entry2 = LlmEntry(provider="gemini", model="entry-2", max_request_tokens=cost_1, timeout_s=30.0)

    model2 = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "NoteSectionNotes",
                            "args": NoteSectionNotes(clean_text="Clean 1").model_dump(),
                            "id": "m1",
                        }
                    ],
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "NoteSectionNotes",
                            "args": NoteSectionNotes(clean_text="Clean 2").model_dump(),
                            "id": "m2",
                        }
                    ],
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "NoteAnalysis",
                            "args": NoteAnalysis(
                                title="Map-reduced Note",
                                tags=["note"],
                                key_points=[Item(text="KP", sources=[1])],
                                clean_text="tmp",
                            ).model_dump(),
                            "id": "red",
                        }
                    ],
                ),
            ]
        )
    )

    registry = make_test_registry([entry1, entry2])
    analyzer = SummarizerAnalyzer(registry)

    def mock_models_for_entry(entry: LlmEntry) -> BaseChatModel:
        if entry.model == "entry-1":
            return model1
        return model2

    analyzer.models_for_entry = mock_models_for_entry  # type: ignore[assignment]

    result = analyzer.analyze(req)
    assert isinstance(result, NoteAnalysis)
    assert result.clean_text == "Clean 1\n\nClean 2"
    assert len(model2.bindings) == 3
