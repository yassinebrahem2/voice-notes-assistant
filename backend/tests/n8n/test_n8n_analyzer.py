import os

import httpx
import pytest
from pydantic import HttpUrl, SecretStr

from app.agents.prompts import load_prompt
from app.agents.schemas import MeetingAnalysis, NoteAnalysis
from app.agents.transcript_input import render_transcript
from app.config.models_registry import LlmEntry, LocalModel, ModelsRegistry, Provider, Roles
from app.n8n.analyzer import N8nAnalyzer
from app.n8n.client import N8nBadResponse, N8nClient, N8nUnavailable
from app.n8n.settings import N8nSettings
from app.processing.protocols import AnalysisRequest, TranscriptLine


@pytest.fixture(autouse=True)
def clean_n8n_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in tuple(os.environ):
        if key.startswith("N8N_") or key == "AI_BACKEND":
            monkeypatch.delenv(key, raising=False)


def _sample_registry() -> ModelsRegistry:
    return ModelsRegistry(
        providers={
            "groq": Provider(
                client="openai", base_url=HttpUrl("https://api.groq.com/openai/v1"), key_env="GROQ_API_KEY"
            ),
            "gemini": Provider(client="google_genai", key_env="GEMINI_API_KEY"),
        },
        roles=Roles(
            llm=[
                LlmEntry(provider="gemini", model="gemini-3.1-flash-lite", max_request_tokens=8192, timeout_s=30),
            ],
            llm_analysis=[
                LlmEntry(provider="gemini", model="gemini-3.1-flash-lite", max_request_tokens=32768, timeout_s=60),
                LlmEntry(provider="groq", model="groq-analysis", max_request_tokens=32768, timeout_s=60),
            ],
            embedder=LocalModel(model="bge", device="cpu"),
            asr=LocalModel(model="asr", device="cpu"),
            diarizer=LocalModel(model="diar", device="cpu"),
        ),
    )


def test_analyzer_sends_single_call_payload() -> None:
    captured_payloads: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        data = json.loads(request.content.decode("utf-8"))
        captured_payloads.append(data)
        if data.get("kind") == "meeting":
            return httpx.Response(
                200,
                json={
                    "title": "Meeting Title",
                    "tags": ["budget"],
                    "overview": "Overview",
                    "decisions": [{"text": "Decision", "sources": [1]}],
                    "action_items": [{"text": "Action", "sources": [2], "owner": None, "due": None}],
                    "open_questions": [{"text": "Question", "sources": [1]}],
                },
            )
        return httpx.Response(
            200,
            json={
                "title": "Note Title",
                "tags": ["budget"],
                "key_points": [{"text": "Point", "sources": [1]}],
                "clean_text": "Clean",
            },
        )

    transport = httpx.MockTransport(handler)
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    registry = _sample_registry()
    analyzer = N8nAnalyzer(registry, client)

    lines = [
        TranscriptLine(s=1, speaker_label="Alice", text="First line"),
        TranscriptLine(s=2, speaker_label="Bob", text="Second line"),
    ]
    req_meeting = AnalysisRequest(kind="meeting", lines=lines, tag_vocabulary=["budget"])
    res_meeting = analyzer.analyze(req_meeting)
    assert isinstance(res_meeting, MeetingAnalysis)
    assert len(captured_payloads) == 1
    assert captured_payloads[0] == {
        "kind": "meeting",
        "model": "gemini-3.1-flash-lite",
        "system_prompt": load_prompt("summarizer_meeting"),
        "user_content": f"{render_transcript(lines)}\n\nExisting tags: budget",
    }

    req_note = AnalysisRequest(kind="note", lines=lines, tag_vocabulary=["budget"])
    res_note = analyzer.analyze(req_note)
    assert isinstance(res_note, NoteAnalysis)
    assert len(captured_payloads) == 2
    assert captured_payloads[1] == {
        "kind": "note",
        "model": "gemini-3.1-flash-lite",
        "system_prompt": load_prompt("summarizer_note"),
        "user_content": f"{render_transcript(lines)}\n\nExisting tags: budget",
    }


def test_analyzer_validates_by_kind() -> None:
    valid_meeting_payload = {
        "title": "Meeting Sync",
        "tags": ["budget"],
        "overview": "Meeting Overview",
        "decisions": [{"text": "Decision 1", "sources": [1]}],
        "action_items": [{"text": "Action 1", "sources": [2], "owner": None, "due": None}],
        "open_questions": [{"text": "Question 1", "sources": [1]}],
    }

    transport = httpx.MockTransport(lambda req: httpx.Response(200, json=valid_meeting_payload))
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    registry = _sample_registry()
    analyzer = N8nAnalyzer(registry, client)

    lines = [TranscriptLine(s=1, speaker_label="Alice", text="Discussion")]
    req_meeting = AnalysisRequest(kind="meeting", lines=lines, tag_vocabulary=[])
    meeting_analysis = analyzer.analyze(req_meeting)
    assert isinstance(meeting_analysis, MeetingAnalysis)
    assert meeting_analysis.title == "Meeting Sync"

    # For a note request, the meeting reply fails validation (missing key_points, clean_text)
    req_note = AnalysisRequest(kind="note", lines=lines, tag_vocabulary=[])
    with pytest.raises(N8nBadResponse):
        analyzer.analyze(req_note)


def test_analyzer_retries_once() -> None:
    call_count = 0

    def retry_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # Over 60 characters title
            return httpx.Response(
                200,
                json={
                    "title": "A" * 65,
                    "tags": ["tag"],
                    "overview": "Overview",
                    "decisions": [],
                    "action_items": [],
                    "open_questions": [],
                },
            )
        return httpx.Response(
            200,
            json={
                "title": "Valid Short Title",
                "tags": ["tag"],
                "overview": "Overview",
                "decisions": [],
                "action_items": [],
                "open_questions": [],
            },
        )

    transport = httpx.MockTransport(retry_handler)
    settings = N8nSettings(n8n_url="http://n8n.test")
    client = N8nClient(settings, SecretStr("test-secret"), transport=transport)
    registry = _sample_registry()
    analyzer = N8nAnalyzer(registry, client)

    lines = [TranscriptLine(s=1, speaker_label="Alice", text="Discussion")]
    req = AnalysisRequest(kind="meeting", lines=lines, tag_vocabulary=[])
    result = analyzer.analyze(req)
    assert isinstance(result, MeetingAnalysis)
    assert result.title == "Valid Short Title"
    assert call_count == 2

    # Two invalid responses -> raises N8nBadResponse
    bad_transport = httpx.MockTransport(
        lambda req: httpx.Response(
            200,
            json={
                "title": "A" * 65,
                "tags": ["tag"],
                "overview": "Overview",
                "decisions": [],
                "action_items": [],
                "open_questions": [],
            },
        )
    )
    client_bad = N8nClient(settings, SecretStr("test-secret"), transport=bad_transport)
    analyzer_bad = N8nAnalyzer(registry, client_bad)
    with pytest.raises(N8nBadResponse):
        analyzer_bad.analyze(req)

    # N8nUnavailable is not retried
    unavailable_count = 0

    def unavailable_handler(request: httpx.Request) -> httpx.Response:
        nonlocal unavailable_count
        unavailable_count += 1
        return httpx.Response(503, text="Service Unavailable")

    unavail_transport = httpx.MockTransport(unavailable_handler)
    client_unavail = N8nClient(settings, SecretStr("test-secret"), transport=unavail_transport)
    analyzer_unavail = N8nAnalyzer(registry, client_unavail)
    with pytest.raises(N8nUnavailable):
        analyzer_unavail.analyze(req)
    assert unavailable_count == 1
