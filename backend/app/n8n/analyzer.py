"""Analyzer calling n8n analyze webhook."""

from __future__ import annotations

from pydantic import ValidationError

from app.agents.prompts import load_prompt
from app.agents.schemas import MeetingAnalysis, NoteAnalysis
from app.agents.summarizer import SummarizerAnalyzer
from app.agents.transcript_input import render_transcript
from app.config import ConfigError
from app.config.models_registry import ModelsRegistry
from app.n8n.client import N8nBadResponse, N8nClient, first_gemini_entry
from app.processing.protocols import AnalysisRequest


class N8nAnalyzer(SummarizerAnalyzer):
    """Analyzer running summarization pipelines through n8n."""

    def __init__(self, registry: ModelsRegistry, client: N8nClient) -> None:
        super().__init__(registry)
        self.client = client

    def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis:
        entry = first_gemini_entry(self.registry, self.registry.roles.llm_analysis)
        if entry is None:
            raise ConfigError("No google_genai entry in llm_analysis")

        tags_text = self._format_tags_text(request.tag_vocabulary)
        prompt_name = "summarizer_meeting" if request.kind == "meeting" else "summarizer_note"
        system_prompt = load_prompt(prompt_name)
        user_content = f"{render_transcript(request.lines)}\n\n{tags_text}"

        payload: dict[str, object] = {
            "kind": request.kind,
            "model": entry.model,
            "system_prompt": system_prompt,
            "user_content": user_content,
        }

        last_exc: Exception | None = None
        for _ in range(2):
            try:
                reply = self.client.post("analyze", payload)
                if request.kind == "meeting":
                    return MeetingAnalysis.model_validate(reply)
                return NoteAnalysis.model_validate(reply)
            except (ValidationError, N8nBadResponse) as exc:
                last_exc = exc
                continue

        raise N8nBadResponse("Failed to obtain valid analysis from n8n") from last_exc
