"""Summarizer agent and analyzer implementation with failover and map-reduce."""

from typing import Any, TypeVar, cast

from langchain.agents import create_agent  # pyright: ignore[reportUnknownVariableType]
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage
from langgraph.graph.state import CompiledStateGraph  # pyright: ignore[reportMissingTypeStubs]
from pydantic import BaseModel

from app.agents.prompts import load_prompt
from app.agents.schemas import (
    MeetingAnalysis,
    MeetingSectionNotes,
    NoteAnalysis,
    NoteSectionNotes,
)
from app.agents.transcript_input import render_transcript
from app.config.models_registry import LlmEntry, ModelsRegistry
from app.llm.factory import chat_model
from app.llm.force_output import ForceOutputToolMiddleware
from app.processing.protocols import AnalysisRequest, TranscriptLine

OUTPUT_ALLOWANCE: int = 2000

T = TypeVar("T", bound=BaseModel)


def estimate_tokens(text: str) -> int:
    """Estimate token count as len(text) // 4 + 1."""
    return len(text) // 4 + 1


class AnalysisFailed(Exception):
    """Raised when all configured llm_analysis entries fail."""


class SummarizerAnalyzer:
    """Analyzer implementing the Summarizer agent across configured models."""

    def __init__(self, registry: ModelsRegistry) -> None:
        self.registry = registry

    def models_for_entry(self, entry: LlmEntry) -> BaseChatModel:
        """Build the chat model for an entry. Hook for test injection."""
        return chat_model(entry, self.registry)

    def _build_entry_agent(
        self,
        entry: LlmEntry,
        *,
        name: str,
        system_prompt: str,
        schema: type[BaseModel],
    ) -> CompiledStateGraph[Any, Any, Any, Any]:
        model = self.models_for_entry(entry)
        middleware = [
            ForceOutputToolMiddleware(from_turn=1),
            ModelCallLimitMiddleware(run_limit=2, exit_behavior="end"),
        ]
        return create_agent(
            model=model,
            tools=[],
            system_prompt=system_prompt,
            response_format=ToolStrategy(schema),
            name=name,
            middleware=middleware,
        )

    def _run_entry_agent(
        self,
        entry: LlmEntry,
        *,
        name: str,
        system_prompt: str,
        schema: type[T],
        user_content: str,
    ) -> T | None:
        try:
            agent = self._build_entry_agent(
                entry,
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
            return None
        except Exception:
            return None

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
                    lines.append(f"- {d.text} ({src})")
            if s.action_items:
                lines.append("Action Items:")
                for a in s.action_items:
                    src = ", ".join(f"[S {x}]" for x in a.sources)
                    owner = f"owner: {a.owner}" if a.owner else "no owner"
                    due = f"due: {a.due}" if a.due else "no due"
                    lines.append(f"- {a.text} ({owner}, {due}) ({src})")
            if s.open_questions:
                lines.append("Open Questions:")
                for q in s.open_questions:
                    src = ", ".join(f"[S {x}]" for x in q.sources)
                    lines.append(f"- {q.text} ({src})")
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
                    lines.append(f"- {kp.text} ({src})")
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

        for entry in entries:
            single_tokens_needed = estimate_tokens(single_prompt + single_user_content) + OUTPUT_ALLOWANCE

            # Check if single call fits
            if single_tokens_needed <= entry.max_request_tokens:
                if request.kind == "meeting":
                    res_m = self._run_entry_agent(
                        entry,
                        name="summarizer_meeting",
                        system_prompt=single_prompt,
                        schema=MeetingAnalysis,
                        user_content=single_user_content,
                    )
                    if res_m is not None:
                        return res_m
                else:
                    res_n = self._run_entry_agent(
                        entry,
                        name="summarizer_note",
                        system_prompt=single_prompt,
                        schema=NoteAnalysis,
                        user_content=single_user_content,
                    )
                    if res_n is not None:
                        return res_n
                # Single call failed, move to next entry
                continue

            # Otherwise, map-reduce
            map_prompt_name = "summarizer_meeting_map" if request.kind == "meeting" else "summarizer_note_map"
            map_prompt = load_prompt(map_prompt_name)
            sections = self._split_lines_into_sections(request.lines, map_prompt, tags_text, entry.max_request_tokens)

            if request.kind == "meeting":
                meeting_sections: list[MeetingSectionNotes] = []
                section_failed = False
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
                    if sec_res is None:
                        section_failed = True
                        break
                    meeting_sections.append(sec_res)

                if section_failed:
                    continue

                reduce_prompt = load_prompt("summarizer_reduce")
                reduce_content = self._format_meeting_reduce_content(meeting_sections, tags_text)
                reduced_meeting = self._run_entry_agent(
                    entry,
                    name="summarizer_reduce",
                    system_prompt=reduce_prompt,
                    schema=MeetingAnalysis,
                    user_content=reduce_content,
                )
                if reduced_meeting is not None:
                    return reduced_meeting

            else:
                note_sections: list[NoteSectionNotes] = []
                section_failed = False
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
                    if sec_res is None:
                        section_failed = True
                        break
                    note_sections.append(sec_res)

                if section_failed:
                    continue

                reduce_prompt = load_prompt("summarizer_reduce")
                reduce_content = self._format_note_reduce_content(note_sections, tags_text)
                reduced_note = self._run_entry_agent(
                    entry,
                    name="summarizer_reduce",
                    system_prompt=reduce_prompt,
                    schema=NoteAnalysis,
                    user_content=reduce_content,
                )
                if reduced_note is not None:
                    clean_parts = [s.clean_text for s in note_sections]
                    joined_clean = "\n\n".join(part for part in clean_parts if part)
                    return reduced_note.model_copy(update={"clean_text": joined_clean})

        raise AnalysisFailed("All analysis models failed")
