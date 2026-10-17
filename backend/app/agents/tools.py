"""Tools for the orchestrator agent: search_transcripts, find_recordings, and summarize."""

import json
import re
from typing import Any, cast

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import HumanMessage

from app.agents.chat_context import ChatContext
from app.agents.prompts import load_prompt
from app.agents.schemas import ChatSummary, ChatSummaryActionItem, ChatSummaryItem
from app.agents.transcript_input import escape_untrusted
from app.db.connection import connect
from app.domain.analysis import MeetingSummary, NoteContent
from app.domain.analysis_render import render_analysis
from app.domain.speakers import render_speakers
from app.llm.factory import build_agent
from app.llm.force_output import ForceOutputToolMiddleware
from app.rag.retrieve import Hit, search_chunks

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
  AND (:like_text IS NULL OR (r.title LIKE :like_text OR r.analysis LIKE :like_text))
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
            return "<sources>\n</sources>"

        runtime.context.sources.found_relevant = True
        passages: list[str] = []

        for hit in hits:
            label = runtime.context.sources.add_passage(hit)
            date_str = hit.created_at[:10]
            sec = hit.start_ms // 1000
            time_str = f"{sec // 60:02d}:{sec % 60:02d}"
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
                "like_text": f"%{text}%" if text else None,
            },
        ).fetchall()

        if not rows:
            return "<sources>\n</sources>"

        lines: list[str] = []
        for row in rows:
            label = runtime.context.sources.add_recording(row)
            title = str(row["title"])
            date_str = str(row["created_at"])[:10]

            dur_ms = row["duration_ms"]
            if dur_ms is not None:
                sec = int(dur_ms) // 1000
                dur_str = f"{sec // 60:02d}:{sec % 60:02d}"
            else:
                dur_str = "00:00"

            tag_rows = conn.execute(
                """SELECT t.name FROM tags t
                JOIN recording_tags rt ON rt.tag_id = t.id
                WHERE rt.recording_id = ? ORDER BY t.name ASC""",
                (row["id"],),
            ).fetchall()
            tag_names = [str(tr["name"]) for tr in tag_rows]
            tags_str = ", ".join(tag_names) if tag_names else "none"

            spk_rows = conn.execute(
                "SELECT id, label, name FROM speakers WHERE recording_id = ?",
                (row["id"],),
            ).fetchall()
            id_to_display = {
                str(sr["id"]): (str(sr["name"]) if sr["name"] else f"Speaker {sr['label']}") for sr in spk_rows
            }

            raw_analysis = row["analysis"]
            desc = ""
            if raw_analysis:
                try:
                    if row["kind"] == "meeting":
                        ms = MeetingSummary.model_validate_json(raw_analysis)
                        desc = render_speakers(ms.overview, id_to_display)
                    else:
                        nc = NoteContent.model_validate_json(raw_analysis)
                        if nc.key_points:
                            desc = render_speakers(nc.key_points[0].text, id_to_display)
                        else:
                            desc = render_speakers(nc.clean_text, id_to_display)
                except Exception:
                    desc = ""

            escaped_desc = escape_untrusted(desc)
            lines.append(f"[{label}] {title} · {date_str} · {dur_str} · {tags_str} · {escaped_desc}")

        body = "\n".join(lines)
        return f"<sources>\n{body}\n</sources>"
    finally:
        conn.close()


@tool
def summarize(
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
                return "not ready yet"
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
            row = rec_rows[0]
            rec_id = str(row["id"])
            title = str(row["title"])
            created_at = str(row["created_at"])
            spk_rows = conn.execute(
                "SELECT id, label, name FROM speakers WHERE recording_id = ?",
                (rec_id,),
            ).fetchall()
            id_to_display = {
                str(sr["id"]): (str(sr["name"]) if sr["name"] else f"Speaker {sr['label']}") for sr in spk_rows
            }

            raw_analysis = str(row["analysis"])
            lines: list[str] = []

            if row["kind"] == "meeting":
                meeting_summary = MeetingSummary.model_validate_json(raw_analysis)
                rendered = render_analysis(meeting_summary, id_to_display)
                lines.append(f"Overview:\n{rendered.overview}")

                if rendered.decisions:
                    lines.append("Decisions:")
                    for item in rendered.decisions:
                        first_seg = item.citations[0].segment_id if item.citations else str(row["first_segment_id"])
                        start_ms = item.citations[0].start_ms if item.citations else 0
                        hit = Hit(
                            recording_id=rec_id,
                            recording_title=title,
                            kind="meeting",
                            created_at=created_at,
                            first_segment_id=first_seg,
                            start_ms=start_ms,
                            end_ms=start_ms,
                            text=item.text,
                            distance=0.0,
                        )
                        p_label = runtime.context.sources.add_passage(hit)
                        lines.append(f"- [{p_label}] {item.text}")

                if rendered.action_items:
                    lines.append("Action items:")
                    for a_item in rendered.action_items:
                        first_seg = a_item.citations[0].segment_id if a_item.citations else str(row["first_segment_id"])
                        start_ms = a_item.citations[0].start_ms if a_item.citations else 0
                        hit = Hit(
                            recording_id=rec_id,
                            recording_title=title,
                            kind="meeting",
                            created_at=created_at,
                            first_segment_id=first_seg,
                            start_ms=start_ms,
                            end_ms=start_ms,
                            text=a_item.text,
                            distance=0.0,
                        )
                        p_label = runtime.context.sources.add_passage(hit)
                        owner_info = (
                            f" (Owner: {id_to_display.get(a_item.owner_speaker_id, a_item.owner_speaker_id)})"
                            if a_item.owner_speaker_id
                            else ""
                        )
                        due_info = f" (Due: {a_item.due})" if a_item.due else ""
                        lines.append(f"- [{p_label}] {a_item.text}{owner_info}{due_info}")

                if rendered.open_questions:
                    lines.append("Open questions:")
                    for q_item in rendered.open_questions:
                        first_seg = q_item.citations[0].segment_id if q_item.citations else str(row["first_segment_id"])
                        start_ms = q_item.citations[0].start_ms if q_item.citations else 0
                        hit = Hit(
                            recording_id=rec_id,
                            recording_title=title,
                            kind="meeting",
                            created_at=created_at,
                            first_segment_id=first_seg,
                            start_ms=start_ms,
                            end_ms=start_ms,
                            text=q_item.text,
                            distance=0.0,
                        )
                        p_label = runtime.context.sources.add_passage(hit)
                        lines.append(f"- [{p_label}] {q_item.text}")
            else:
                note_content = NoteContent.model_validate_json(raw_analysis)
                rendered = render_analysis(note_content, id_to_display)
                lines.append("Key points:")
                for k_item in rendered.key_points:
                    first_seg = k_item.citations[0].segment_id if k_item.citations else str(row["first_segment_id"])
                    start_ms = k_item.citations[0].start_ms if k_item.citations else 0
                    hit = Hit(
                        recording_id=rec_id,
                        recording_title=title,
                        kind="note",
                        created_at=created_at,
                        first_segment_id=first_seg,
                        start_ms=start_ms,
                        end_ms=start_ms,
                        text=k_item.text,
                        distance=0.0,
                    )
                    p_label = runtime.context.sources.add_passage(hit)
                    lines.append(f"- [{p_label}] {k_item.text}")
                if rendered.clean_text:
                    lines.append(f"Content:\n{rendered.clean_text}")

            output_text = escape_untrusted("\n\n".join(lines))
            return f"<sources>\n{output_text}\n</sources>"

        # Several recordings: merge using chat_merge agent
        per_recording_blocks: list[str] = []
        for row in rec_rows:
            rec_id = str(row["id"])
            lbl = rec_id_to_label[rec_id]
            title = str(row["title"])
            spk_rows = conn.execute(
                "SELECT id, label, name FROM speakers WHERE recording_id = ?",
                (rec_id,),
            ).fetchall()
            id_to_display = {
                str(sr["id"]): (str(sr["name"]) if sr["name"] else f"Speaker {sr['label']}") for sr in spk_rows
            }
            raw_analysis = str(row["analysis"])

            rec_block_lines = [f"[{lbl}] {title}:"]
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

            per_recording_blocks.append("\n".join(rec_block_lines))

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
            agent.invoke({"messages": [HumanMessage(content=user_prompt)]}),  # pyright: ignore[reportUnknownMemberType]
        )
        structured: ChatSummary | None = agent_res.get("structured_response")
        if structured is None:
            return "not ready yet"

        valid_decisions: list[ChatSummaryItem] = []
        for d in structured.decisions:
            valid_srcs = [s for s in d.sources if runtime.context.sources.resolve(s) is not None]
            if valid_srcs:
                d.sources = valid_srcs
                valid_decisions.append(d)

        valid_actions: list[ChatSummaryActionItem] = []
        for a in structured.action_items:
            valid_srcs = [s for s in a.sources if runtime.context.sources.resolve(s) is not None]
            if valid_srcs:
                a.sources = valid_srcs
                valid_actions.append(a)

        valid_questions: list[ChatSummaryItem] = []
        for q in structured.open_questions:
            valid_srcs = [s for s in q.sources if runtime.context.sources.resolve(s) is not None]
            if valid_srcs:
                q.sources = valid_srcs
                valid_questions.append(q)

        out_lines: list[str] = [f"Overview:\n{structured.overview}"]
        if valid_decisions:
            out_lines.append("Decisions:")
            for d in valid_decisions:
                src_labels = " ".join(f"[{s}]" for s in d.sources)
                out_lines.append(f"- {src_labels} {d.text}")
        if valid_actions:
            out_lines.append("Action items:")
            for a in valid_actions:
                src_labels = " ".join(f"[{s}]" for s in a.sources)
                owner_info = f" (Owner: {a.owner})" if a.owner else ""
                due_info = f" (Due: {a.due})" if a.due else ""
                out_lines.append(f"- {src_labels} {a.text}{owner_info}{due_info}")
        if valid_questions:
            out_lines.append("Open questions:")
            for q in valid_questions:
                src_labels = " ".join(f"[{s}]" for s in q.sources)
                out_lines.append(f"- {src_labels} {q.text}")

        merged_out = escape_untrusted("\n\n".join(out_lines))
        return f"<sources>\n{merged_out}\n</sources>"
    finally:
        conn.close()
