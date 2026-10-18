"""Summarizer agent and analyzer implementation with failover and map-reduce."""

import logging
from typing import Any, TypeVar, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from app.agents.prompts import load_prompt
from app.agents.schemas import (
    MeetingAnalysis,
    MeetingSectionNotes,
    NoteAnalysis,
    NoteSectionNotes,
)
from app.agents.transcript_input import escape_untrusted, render_transcript
from app.api.errors import describe_frames
from app.config.models_registry import LlmEntry, ModelsRegistry
from app.llm.factory import build_entry_agent, chat_model
from app.processing.protocols import AnalysisRequest, TranscriptLine

logger = logging.getLogger(__name__)

OUTPUT_ALLOWANCE: int = 2000

T = TypeVar("T", bound=BaseModel)


def estimate_tokens(text: str) -> int:
    """Estimate token count as len(text) // 4 + 1."""
    return len(text) // 4 + 1


class AnalysisFailed(Exception):
    """Raised when all configured llm_analysis entries fail."""


class NoStructuredResponse(Exception):
    """Raised when an entry agent returns an invalid or missing structured response."""


class SummarizerAnalyzer:
    """Analyzer implementing the Summarizer agent across configured models."""

    def __init__(self, registry: ModelsRegistry) -> None:
        self.registry = registry

    def models_for_entry(self, entry: LlmEntry) -> BaseChatModel:
        """Build the chat model for an entry. Hook for test injection."""
        return chat_model(entry, self.registry)

    def _run_entry_agent(
        self,
        entry: LlmEntry,
        *,
        name: str,
        system_prompt: str,
        schema: type[T],
        user_content: str,
    ) -> T:
        agent = build_entry_agent(
            self.models_for_entry(entry),
            name=name,
            system_prompt=system_prompt,
            schema=schema,
        )
        raw_output = agent.invoke(  # pyright: ignore[reportUnknownMemberType] - langgraph CompiledStateGraph.invoke has partially unknown overload signature
            {"messages": [HumanMessage(content=user_content)]}
        )
        output = cast(dict[str, Any], raw_output)
        response = output.get("structured_response")
        if isinstance(response, schema):
            return response
        raise NoStructuredResponse(
            f"Model {entry.provider}/{entry.model} returned invalid or missing structured response"
        )

    def _format_tags_text(self, vocabulary: list[str]) -> str:
        if vocabulary:
            return f"Existing tags: {', '.join(vocabulary[:40])}"
        return "Existing tags: none"

    def _split_lines_into_sections(
        self,
        lines: list[TranscriptLine],
        map_prompt: str,
        tags_text: str,
        max_tokens: int,
    ) -> list[list[TranscriptLine]]:
        if not lines:
            return []

        sections: list[list[TranscriptLine]] = []
        current_section: list[TranscriptLine] = []

        for line in lines:
            candidate = [*current_section, line]
            candidate_content = f"{render_transcript(candidate)}\n\n{tags_text}"
            tokens = estimate_tokens(map_prompt + candidate_content) + OUTPUT_ALLOWANCE
            if tokens <= max_tokens or not current_section:
                current_section.append(line)
            else:
                sections.append(current_section)
                current_section = [line]

        if current_section:
            sections.append(current_section)

        return sections

    def _format_meeting_reduce_content(
        self,
        sections: list[MeetingSectionNotes],
        tags_text: str,
    ) -> str:
        lines: list[str] = ["<section_notes>"]
        for i, s in enumerate(sections, start=1):
            lines.append(f"Section {i}:")
            if s.decisions:
                lines.append("Decisions:")
                for d in s.decisions:
                    src = ", ".join(f"[S {x}]" for x in d.sources)
                    lines.append(f"- {escape_untrusted(d.text)} ({src})")
            if s.action_items:
                lines.append("Action Items:")
                for a in s.action_items:
                    src = ", ".join(f"[S {x}]" for x in a.sources)
                    owner = f"owner: {escape_untrusted(a.owner)}" if a.owner else "no owner"
                    due = f"due: {escape_untrusted(a.due)}" if a.due else "no due"
                    lines.append(f"- {escape_untrusted(a.text)} ({owner}, {due}) ({src})")
            if s.open_questions:
                lines.append("Open Questions:")
                for q in s.open_questions:
                    src = ", ".join(f"[S {x}]" for x in q.sources)
                    lines.append(f"- {escape_untrusted(q.text)} ({src})")
        lines.append("</section_notes>")
        lines.append("")
        lines.append(tags_text)
        return "\n".join(lines)

    def _format_note_reduce_content(
        self,
        sections: list[NoteSectionNotes],
        tags_text: str,
    ) -> str:
        lines: list[str] = ["<section_notes>"]
        for i, s in enumerate(sections, start=1):
            lines.append(f"Section {i}:")
            if s.key_points:
                lines.append("Key Points:")
                for kp in s.key_points:
                    src = ", ".join(f"[S {x}]" for x in kp.sources)
                    lines.append(f"- {escape_untrusted(kp.text)} ({src})")
        lines.append("</section_notes>")
        lines.append("")
        lines.append(tags_text)
        return "\n".join(lines)

    def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis:
        """Analyze a transcript request using the configured llm_analysis models."""
        entries = self.registry.roles.llm_analysis
        if not entries:
            raise AnalysisFailed("No llm_analysis models configured in registry")

        tags_text = self._format_tags_text(request.tag_vocabulary)
        prompt_name = "summarizer_meeting" if request.kind == "meeting" else "summarizer_note"
        single_prompt = load_prompt(prompt_name)
        full_transcript = render_transcript(request.lines)
        single_user_content = f"{full_transcript}\n\n{tags_text}"

        last_error: Exception | None = None
        for entry in entries:
            try:
                single_tokens_needed = estimate_tokens(single_prompt + single_user_content) + OUTPUT_ALLOWANCE

                # Check if single call fits
                if single_tokens_needed <= entry.max_request_tokens:
                    if request.kind == "meeting":
                        return self._run_entry_agent(
                            entry,
                            name="summarizer_meeting",
                            system_prompt=single_prompt,
                            schema=MeetingAnalysis,
                            user_content=single_user_content,
                        )
                    return self._run_entry_agent(
                        entry,
                        name="summarizer_note",
                        system_prompt=single_prompt,
                        schema=NoteAnalysis,
                        user_content=single_user_content,
                    )

                # Otherwise, map-reduce
                map_prompt_name = "summarizer_meeting_map" if request.kind == "meeting" else "summarizer_note_map"
                map_prompt = load_prompt(map_prompt_name)
                sections = self._split_lines_into_sections(
                    request.lines, map_prompt, tags_text, entry.max_request_tokens
                )

                if request.kind == "meeting":
                    meeting_sections: list[MeetingSectionNotes] = []
                    for section in sections:
                        sec_transcript = render_transcript(section)
                        sec_content = f"{sec_transcript}\n\n{tags_text}"
                        sec_res = self._run_entry_agent(
                            entry,
                            name="summarizer_meeting_map",
                            system_prompt=map_prompt,
                            schema=MeetingSectionNotes,
                            user_content=sec_content,
                        )
                        meeting_sections.append(sec_res)

                    reduce_prompt = load_prompt("summarizer_reduce")
                    reduce_content = self._format_meeting_reduce_content(meeting_sections, tags_text)
                    return self._run_entry_agent(
                        entry,
                        name="summarizer_reduce",
                        system_prompt=reduce_prompt,
                        schema=MeetingAnalysis,
                        user_content=reduce_content,
                    )

                note_sections: list[NoteSectionNotes] = []
                for section in sections:
                    sec_transcript = render_transcript(section)
                    sec_content = f"{sec_transcript}\n\n{tags_text}"
                    sec_res = self._run_entry_agent(
                        entry,
                        name="summarizer_note_map",
                        system_prompt=map_prompt,
                        schema=NoteSectionNotes,
                        user_content=sec_content,
                    )
                    note_sections.append(sec_res)

                reduce_prompt = load_prompt("summarizer_reduce")
                reduce_content = self._format_note_reduce_content(note_sections, tags_text)
                reduced_note = self._run_entry_agent(
                    entry,
                    name="summarizer_reduce",
                    system_prompt=reduce_prompt,
                    schema=NoteAnalysis,
                    user_content=reduce_content,
                )
                clean_parts = [s.clean_text for s in note_sections]
                joined_clean = "\n\n".join(part for part in clean_parts if part)
                return reduced_note.model_copy(update={"clean_text": joined_clean})

            except Exception as exc:
                last_error = exc
                if isinstance(exc, NoStructuredResponse):
                    logger.warning(
                        "Analysis model %s/%s returned invalid or missing structured response",
                        entry.provider,
                        entry.model,
                    )
                else:
                    logger.warning(
                        "Analysis failed for provider=%s model=%s: %s at %s",
                        entry.provider,
                        entry.model,
                        type(exc).__name__,
                        describe_frames(exc),
                    )

        raise AnalysisFailed("All analysis models failed") from last_error
