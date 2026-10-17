"""Rendering and formatting helpers for recording summarization."""

import re
import sqlite3
from typing import Any

from app.agents.schemas import ChatSummary, ChatSummaryActionItem, ChatSummaryItem
from app.agents.sources import SourceRegistry
from app.agents.transcript_input import escape_untrusted
from app.domain.analysis import AnalysisItem, MeetingSummary, NoteContent
from app.domain.analysis_render import render_analysis
from app.domain.types import RecordingKind
from app.rag.retrieve import Hit


def get_speaker_display_map(conn: sqlite3.Connection, recording_id: str) -> dict[str, str]:
    """Return a mapping of speaker ID to display name (custom name or 'Speaker <label>')."""
    rows = conn.execute(
        "SELECT id, label, name FROM speakers WHERE recording_id = ?",
        (recording_id,),
    ).fetchall()
    return {str(r["id"]): (str(r["name"]) if r["name"] else f"Speaker {r['label']}") for r in rows}


def normalize_source_label(s: str) -> str:
    """Normalise a source label to uppercase bracketed format, e.g. '[R1]'."""
    return f"[{re.sub(r'[\s\[\]]', '', s).upper()}]"


def format_source_labels(sources: list[str]) -> str:
    """Format a list of source labels as space-separated bracketed labels."""
    return " ".join(normalize_source_label(s) for s in sources)


def filter_resolvable_items[TItem: (ChatSummaryItem, ChatSummaryActionItem)](
    items: list[TItem],
    sources: SourceRegistry,
) -> list[TItem]:
    """Keep items with at least one resolvable source label, updating sources to valid ones."""
    valid: list[TItem] = []
    for item in items:
        valid_srcs = [s for s in item.sources if sources.resolve(s) is not None]
        if valid_srcs:
            item.sources = valid_srcs
            valid.append(item)
    return valid


def format_item_passage(
    sources: SourceRegistry,
    item: AnalysisItem,
    *,
    recording_id: str,
    recording_title: str,
    kind: RecordingKind,
    created_at: str,
    default_segment_id: str,
    suffix: str = "",
) -> str:
    """Register an item citation as a passage in SourceRegistry and format as a bullet."""
    first_seg = item.citations[0].segment_id if item.citations else default_segment_id
    start_ms = item.citations[0].start_ms if item.citations else 0
    hit = Hit(
        recording_id=recording_id,
        recording_title=recording_title,
        kind=kind,
        created_at=created_at,
        first_segment_id=first_seg,
        start_ms=start_ms,
        end_ms=start_ms,
        text=item.text,
        distance=0.0,
    )
    p_label = sources.add_passage(hit)
    return f"- [{p_label}] {item.text}{suffix}"


def render_single_recording_summary(
    row: Any,
    conn: sqlite3.Connection,
    sources: SourceRegistry,
) -> str:
    """Render summary for a single recording, registering passage citations."""
    rec_id = str(row["id"])
    title = str(row["title"])
    created_at = str(row["created_at"])
    default_seg_id = str(row["first_segment_id"])
    id_to_display = get_speaker_display_map(conn, rec_id)

    raw_analysis = str(row["analysis"])
    lines: list[str] = []

    if row["kind"] == "meeting":
        meeting_summary = MeetingSummary.model_validate_json(raw_analysis)
        rendered = render_analysis(meeting_summary, id_to_display)
        lines.append(f"Overview:\n{rendered.overview}")

        if rendered.decisions:
            lines.append("Decisions:")
            for item in rendered.decisions:
                lines.append(
                    format_item_passage(
                        sources,
                        item,
                        recording_id=rec_id,
                        recording_title=title,
                        kind="meeting",
                        created_at=created_at,
                        default_segment_id=default_seg_id,
                    )
                )

        if rendered.action_items:
            lines.append("Action items:")
            for a_item in rendered.action_items:
                owner_info = (
                    f" (Owner: {id_to_display.get(a_item.owner_speaker_id, a_item.owner_speaker_id)})"
                    if a_item.owner_speaker_id
                    else ""
                )
                due_info = f" (Due: {a_item.due})" if a_item.due else ""
                lines.append(
                    format_item_passage(
                        sources,
                        a_item,
                        recording_id=rec_id,
                        recording_title=title,
                        kind="meeting",
                        created_at=created_at,
                        default_segment_id=default_seg_id,
                        suffix=f"{owner_info}{due_info}",
                    )
                )

        if rendered.open_questions:
            lines.append("Open questions:")
            for q_item in rendered.open_questions:
                lines.append(
                    format_item_passage(
                        sources,
                        q_item,
                        recording_id=rec_id,
                        recording_title=title,
                        kind="meeting",
                        created_at=created_at,
                        default_segment_id=default_seg_id,
                    )
                )
    else:
        note_content = NoteContent.model_validate_json(raw_analysis)
        rendered = render_analysis(note_content, id_to_display)
        lines.append("Key points:")
        for k_item in rendered.key_points:
            lines.append(
                format_item_passage(
                    sources,
                    k_item,
                    recording_id=rec_id,
                    recording_title=title,
                    kind="note",
                    created_at=created_at,
                    default_segment_id=default_seg_id,
                )
            )
        if rendered.clean_text:
            lines.append(f"Content:\n{rendered.clean_text}")

    output_text = escape_untrusted("\n\n".join(lines))
    return f"<sources>\n{output_text}\n</sources>"


def format_merge_recording_block(
    row: Any,
    label: str,
    conn: sqlite3.Connection,
) -> str:
    """Format a single recording's analysis block for multi-recording merge prompt."""
    rec_id = str(row["id"])
    title = str(row["title"])
    id_to_display = get_speaker_display_map(conn, rec_id)
    raw_analysis = str(row["analysis"])

    rec_block_lines = [f"[{label}] {title}:"]
    if row["kind"] == "meeting":
        ms = render_analysis(MeetingSummary.model_validate_json(raw_analysis), id_to_display)
        rec_block_lines.append(f"Overview: {ms.overview}")
        if ms.decisions:
            rec_block_lines.append("Decisions: " + "; ".join(d.text for d in ms.decisions))
        if ms.action_items:
            rec_block_lines.append("Action items: " + "; ".join(a.text for a in ms.action_items))
        if ms.open_questions:
            rec_block_lines.append("Open questions: " + "; ".join(q.text for q in ms.open_questions))
    else:
        nc = render_analysis(NoteContent.model_validate_json(raw_analysis), id_to_display)
        if nc.key_points:
            rec_block_lines.append("Key points: " + "; ".join(k.text for k in nc.key_points))
        if nc.clean_text:
            rec_block_lines.append(f"Clean text: {nc.clean_text}")

    return "\n".join(rec_block_lines)


def render_merged_summary(
    structured: ChatSummary,
    sources: SourceRegistry,
) -> str:
    """Render merged summary, dropping items with unresolvable labels."""
    valid_decisions = filter_resolvable_items(structured.decisions, sources)
    valid_actions = filter_resolvable_items(structured.action_items, sources)
    valid_questions = filter_resolvable_items(structured.open_questions, sources)

    out_lines: list[str] = [f"Overview:\n{structured.overview}"]
    if valid_decisions:
        out_lines.append("Decisions:")
        for d in valid_decisions:
            src_labels = format_source_labels(d.sources)
            out_lines.append(f"- {src_labels} {d.text}")
    if valid_actions:
        out_lines.append("Action items:")
        for a in valid_actions:
            src_labels = format_source_labels(a.sources)
            owner_info = f" (Owner: {a.owner})" if a.owner else ""
            due_info = f" (Due: {a.due})" if a.due else ""
            out_lines.append(f"- {src_labels} {a.text}{owner_info}{due_info}")
    if valid_questions:
        out_lines.append("Open questions:")
        for q in valid_questions:
            src_labels = format_source_labels(q.sources)
            out_lines.append(f"- {src_labels} {q.text}")

    merged_out = escape_untrusted("\n\n".join(out_lines))
    return f"<sources>\n{merged_out}\n</sources>"
