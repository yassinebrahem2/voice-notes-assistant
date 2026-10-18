"""Citation verification and reply formatting for chat responses."""

import re
from dataclasses import dataclass
from typing import Literal

from app.agents.schemas import ChatReply
from app.agents.sources import SourceRegistry
from app.api.models.chats import CitationOut

NOT_FOUND = "Not in your recordings."
COULD_NOT_FINISH = "I couldn't finish answering that. Try asking it another way."
GREETING = "Hello! Ask me anything about your notes and meetings."
HELP = (
    "You can ask questions about your voice notes and meetings, like:\n"
    "- What was decided in our last sync?\n"
    "- What are my open action items?\n"
    "- Summarize my notes on architecture."
)
OUT_OF_SCOPE = "I can only help with questions about your recorded notes and meetings."


@dataclass
class FinalReply:
    reply_type: Literal["answer", "greeting", "help", "out_of_scope"]
    text: str
    citations: list[CitationOut]


def check_citations(reply: ChatReply | None, registry: SourceRegistry) -> FinalReply:
    """Validate citations against registry, replace source labels with sequential indices, and construct FinalReply."""
    if reply is None:
        return FinalReply("answer", COULD_NOT_FINISH, [])

    if reply.reply_type == "greeting":
        return FinalReply("greeting", GREETING, [])

    if reply.reply_type == "help":
        return FinalReply("help", HELP, [])

    if reply.reply_type == "out_of_scope":
        return FinalReply("out_of_scope", OUT_OF_SCOPE, [])

    if reply.reply_type == "answer":
        if not reply.text or not reply.text.strip():
            return FinalReply("answer", NOT_FOUND, [])

        label_to_n: dict[str, int] = {}
        citations: list[CitationOut] = []

        # Find citations in order of first use
        for match in re.finditer(r"\[\s*([PRpr]\s*\d+)\s*\]", reply.text):
            raw_label = match.group(1)
            norm_label = re.sub(r"\s+", "", raw_label).upper()
            resolved = registry.resolve(norm_label)
            if resolved is not None and norm_label not in label_to_n:
                k = len(label_to_n) + 1
                label_to_n[norm_label] = k
                citations.append(
                    CitationOut(
                        n=k,
                        recording_id=resolved.recording_id,
                        segment_id=resolved.segment_id,
                        start_ms=resolved.start_ms,
                        recording_title=resolved.recording_title,
                    )
                )

        if not citations:
            return FinalReply("answer", NOT_FOUND, [])

        def replace_citation(match: re.Match[str]) -> str:
            raw_label = match.group(1)
            norm_label = re.sub(r"\s+", "", raw_label).upper()
            if norm_label in label_to_n:
                return f"[{label_to_n[norm_label]}]"
            return ""

        clean_text = re.sub(r"\[\s*([PRpr]\s*\d+)\s*\]", replace_citation, reply.text)
        clean_text = re.sub(r"[ \t]+", " ", clean_text)
        clean_text = re.sub(r" +([.,;!?])", r"\1", clean_text).strip()

        return FinalReply("answer", clean_text, citations)

    raise ValueError(f"Unknown reply_type: {reply.reply_type}")
