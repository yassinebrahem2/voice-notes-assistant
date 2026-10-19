"""Tools for the orchestrator agent: search_transcripts, find_recordings, and summarize."""

import json
import re
from typing import Any, cast

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import HumanMessage

from app.agents.chat_context import ChatContext
from app.agents.prompts import load_prompt
from app.agents.schemas import ChatSummary
from app.agents.summarize_render import (
    format_merge_recording_block,
    get_speaker_display_map,
    render_merged_summary,
    render_single_recording_summary,
)
from app.agents.transcript_input import escape_untrusted
from app.db.connection import connect
from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.speakers import render_speakers
from app.llm.factory import build_agent
from app.llm.force_output import ForceOutputToolMiddleware
from app.rag.retrieve import search_chunks


def format_ms_to_mmss(ms: int | None) -> str:
    """Format milliseconds into MM:SS string, defaulting to '00:00' if None."""
    if ms is None:
        return "00:00"
    sec = int(ms) // 1000
    return f"{sec // 60:02d}:{sec % 60:02d}"


FIND_RECORDINGS_LIMIT = 20


def _escape_like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


FIND_RECORDINGS_SQL = """
SELECT
    r.id,
    COALESCE(r.title, 'Untitled recording') AS title,
    r.kind,
    r.created_at,
    r.duration_ms,
    r.analysis,
    (SELECT s.id FROM segments s WHERE s.recording_id = r.id ORDER BY s.idx ASC LIMIT 1) AS first_segment_id
FROM recordings r
WHERE r.status = 'ready'
  AND (:kind_filter IS NULL OR r.kind = :kind_filter)
  AND (
      :ctx_tags_count = 0
      OR r.id IN (
          SELECT recording_id
          FROM recording_tags
          WHERE tag_id IN (SELECT value FROM json_each(:ctx_tag_ids))
          GROUP BY recording_id
          HAVING COUNT(DISTINCT tag_id) = :ctx_tags_count
      )
  )
  AND (
      :req_tags_count = 0
      OR r.id IN (
          SELECT rt.recording_id
          FROM recording_tags rt
          JOIN tags t ON t.id = rt.tag_id
          WHERE t.name IN (SELECT value FROM json_each(:req_tags))
             OR t.id IN (SELECT value FROM json_each(:req_tags))
          GROUP BY rt.recording_id
          HAVING COUNT(DISTINCT rt.tag_id) >= :req_tags_count
      )
  )
  AND (:date_from IS NULL OR substr(r.created_at, 1, 10) >= :date_from)
  AND (:date_to IS NULL OR substr(r.created_at, 1, 10) <= :date_to)
  AND (
      :like_text IS NULL
      OR (
          r.title LIKE :like_text ESCAPE '\\'
          OR (
              r.analysis IS NOT NULL
              AND json_valid(r.analysis) = 1
              AND EXISTS (
                  SELECT 1 FROM json_tree(r.analysis)
                  WHERE type = 'text' AND value LIKE :like_text ESCAPE '\\'
              )
          )
      )
  )
ORDER BY r.created_at DESC
"""


@tool
def search_transcripts(
    query: str,
    k: int = 8,
    *,
    runtime: ToolRuntime[ChatContext, Any],
) -> str:
    """Search transcript passages within scope and tags."""
    scope = runtime.context.scope
    if scope == "meetings":
        runtime.stream_writer("Searching meetings…")
    elif scope == "notes":
        runtime.stream_writer("Searching notes…")
    else:
        runtime.stream_writer("Searching recordings…")

    conn = connect(runtime.context.db_path)
    try:
        hits = search_chunks(
            conn,
            runtime.context.embedder,
            query,
            scope=scope,
            tag_ids=runtime.context.tag_ids,
            k=k,
            max_distance=runtime.context.settings.retrieval_max_distance,
        )

        runtime.stream_writer(f"Found {len(hits)} passages")

        if not hits:
            return "<sources>\n</sources>\nNo passages matched. Try broader or related terms."

        passages: list[str] = []

        for hit in hits:
            label = runtime.context.sources.add_passage(hit)
            date_str = hit.created_at[:10]
            time_str = format_ms_to_mmss(hit.start_ms)
            title = hit.recording_title or "Untitled recording"
            header = f"[{label}] {title} · {date_str} · {time_str}"

            rows = conn.execute(
                "SELECT label, name FROM speakers WHERE recording_id = ?",
                (hit.recording_id,),
            ).fetchall()
            speaker_names: dict[str, str | None] = {str(r["label"]): r["name"] for r in rows}

            def replace_speaker(
                match: re.Match[str],
                spk_names: dict[str, str | None] = speaker_names,
            ) -> str:
                spk_label = match.group(1)
                custom_name = spk_names.get(spk_label)
                if custom_name:
                    return f"{custom_name} (Speaker {spk_label})"
                return f"Speaker {spk_label}"

            rendered_text = re.sub(r"\bSpeaker ([A-Z])\b", replace_speaker, hit.text)
            escaped_body = escape_untrusted(rendered_text)
            passages.append(f"{header}\n{escaped_body}")

        body = "\n\n".join(passages)
        return f"<sources>\n{body}\n</sources>"
    finally:
        conn.close()


@tool
def find_recordings(
    text: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tags: list[str] | None = None,
    *,
    runtime: ToolRuntime[ChatContext, Any],
) -> str:
    """Find recordings by metadata (title, date range, tags, or text search)."""
    runtime.stream_writer("Looking up recordings…")
    conn = connect(runtime.context.db_path)
    try:
        scope = runtime.context.scope
        kind_filter: str | None = None
        if scope == "notes":
            kind_filter = "note"
        elif scope == "meetings":
            kind_filter = "meeting"

        context_tags = list(dict.fromkeys(runtime.context.tag_ids))
        req_tags = list(dict.fromkeys(tags)) if tags else []

        rows = conn.execute(
            FIND_RECORDINGS_SQL,
            {
                "kind_filter": kind_filter,
                "ctx_tags_count": len(context_tags),
                "ctx_tag_ids": json.dumps(context_tags),
                "req_tags_count": len(req_tags),
                "req_tags": json.dumps(req_tags),
                "date_from": date_from,
                "date_to": date_to,
                "like_text": _escape_like(text) if text else None,
            },
        ).fetchall()

        if not rows:
            return "<sources>\n</sources>"

        displayed_rows = rows[:FIND_RECORDINGS_LIMIT]

        lines: list[str] = []
        for row in displayed_rows:
            label = runtime.context.sources.add_recording(row)
            title = str(row["title"])
            date_str = str(row["created_at"])[:10]
            dur_str = format_ms_to_mmss(row["duration_ms"])

            tag_rows = conn.execute(
                """SELECT t.name FROM tags t
                JOIN recording_tags rt ON rt.tag_id = t.id
                WHERE rt.recording_id = ? ORDER BY t.name ASC""",
                (row["id"],),
            ).fetchall()
            tag_names = [str(tr["name"]) for tr in tag_rows]
            tags_str = ", ".join(tag_names) if tag_names else "none"

            id_to_display = get_speaker_display_map(conn, str(row["id"]))

            raw_analysis = row["analysis"]
            desc = ""
            if raw_analysis:
                if row["kind"] == "meeting":
                    ms = MeetingSummary.model_validate_json(raw_analysis)
                    desc = render_speakers(ms.overview, id_to_display)
                else:
                    nc = NoteContent.model_validate_json(raw_analysis)
                    if nc.key_points:
                        desc = render_speakers(nc.key_points[0].text, id_to_display)
                    else:
                        desc = render_speakers(nc.clean_text, id_to_display)

            escaped_desc = escape_untrusted(desc)
            lines.append(f"[{label}] {title} · {date_str} · {dur_str} · {tags_str} · {escaped_desc}")

        if len(rows) > FIND_RECORDINGS_LIMIT:
            lines.append(f"Showing {FIND_RECORDINGS_LIMIT} of {len(rows)}; narrow by date or tags.")

        body = "\n".join(lines)
        return f"<sources>\n{body}\n</sources>"
    finally:
        conn.close()


@tool
async def summarize(
    sources: list[str],
    focus: str | None = None,
    *,
    runtime: ToolRuntime[ChatContext, Any],
) -> str:
    """Summarize one or more recordings identified by source labels."""
    num_sources = len(sources)
    plural = "recording" if num_sources == 1 else "recordings"
    runtime.stream_writer(f"Summarizing {num_sources} {plural}…")

    conn = connect(runtime.context.db_path)
    try:
        rec_id_to_label: dict[str, str] = {}
        ordered_rec_ids: list[str] = []

        for s in sources:
            resolved = runtime.context.sources.resolve(s)
            if resolved is None:
                return f"Unknown source label {s}."
            rec_id = resolved.recording_id
            if rec_id not in rec_id_to_label:
                rec_id_to_label[rec_id] = s
                ordered_rec_ids.append(rec_id)

        if not ordered_rec_ids:
            return "not ready yet"

        rec_rows: list[Any] = []
        for rec_id in ordered_rec_ids:
            row = conn.execute(
                """SELECT
                    id, kind, status, COALESCE(title, 'Untitled recording') AS title, created_at, analysis,
                    (SELECT s.id FROM segments s WHERE s.recording_id = recordings.id
                     ORDER BY s.idx ASC LIMIT 1) AS first_segment_id
                FROM recordings WHERE id = ?""",
                (rec_id,),
            ).fetchone()
            if row is None or row["status"] != "ready" or not row["analysis"]:
                return "not ready yet"
            rec_rows.append(row)

        if len(rec_rows) == 1:
            return render_single_recording_summary(
                row=rec_rows[0],
                conn=conn,
                sources=runtime.context.sources,
            )

        # Several recordings: merge using chat_merge agent
        per_recording_blocks: list[str] = [
            format_merge_recording_block(
                row,
                rec_id_to_label[str(row["id"])],
                conn,
                runtime.context.sources,
            )
            for row in rec_rows
        ]

        merge_body = escape_untrusted("\n\n".join(per_recording_blocks))
        user_prompt = f"<sources>\n{merge_body}\n</sources>"
        if focus:
            user_prompt += f"\n\nFocus: {focus}"

        merge_prompt = load_prompt("chat_merge")
        agent = build_agent(
            runtime.context.models,
            "llm",
            name="summarizer_merge",
            system_prompt=merge_prompt,
            tools=[],
            schema=ChatSummary,
            extra_middleware=[ForceOutputToolMiddleware(from_turn=1)],
        )

        agent_res = cast(
            dict[str, Any],
            await agent.ainvoke({"messages": [HumanMessage(content=user_prompt)]}),  # pyright: ignore[reportUnknownMemberType]
        )
        structured: ChatSummary | None = agent_res.get("structured_response")
        if structured is None:
            return "not ready yet"

        return render_merged_summary(structured, runtime.context.sources)
    finally:
        conn.close()
