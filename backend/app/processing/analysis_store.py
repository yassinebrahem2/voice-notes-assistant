"""Builds the analyzer's request and stores its checked output on the recording.

The model cites transcript lines by number and speakers by label; both are checked against the recording here, so
nothing it invents reaches the stored analysis. Logs name identifiers and numbers only, never transcript or model
text, which may be private.
"""

import logging
import sqlite3
from collections.abc import Mapping, Sequence

from app.agents.schemas import ActionItem, Item, MeetingAnalysis, NoteAnalysis
from app.domain.analysis import AnalysisActionItem, AnalysisItem, Citation, MeetingSummary, NoteContent
from app.domain.speakers import tokenize_speakers
from app.domain.tags import match_existing_tag, normalize_tag
from app.domain.types import RecordingKind
from app.ids import new_id
from app.processing.protocols import AnalysisRequest, TranscriptLine
from app.rag.chunker import SegmentRow, load_segment_rows

logger = logging.getLogger(__name__)

MAX_TAGS = 4
TAG_VOCABULARY_SIZE = 40

_TAG_VOCABULARY_SQL = """
SELECT t.name FROM tags t JOIN recording_tags rt ON rt.tag_id = t.id
GROUP BY t.id
ORDER BY COUNT(*) DESC, t.name
LIMIT ?
"""


def build_analysis_request(conn: sqlite3.Connection, rec_id: str) -> AnalysisRequest:
    kind: RecordingKind = conn.execute("SELECT kind FROM recordings WHERE id = ?", (rec_id,)).fetchone()["kind"]
    lines = [
        TranscriptLine(s=s, speaker_label=segment.speaker_label, text=segment.text)
        for s, segment in enumerate(load_segment_rows(conn, rec_id), start=1)
    ]
    vocabulary = [row["name"] for row in conn.execute(_TAG_VOCABULARY_SQL, (TAG_VOCABULARY_SIZE,))]
    return AnalysisRequest(kind=kind, lines=lines, tag_vocabulary=vocabulary)


class _Checker:
    """Maps one recording's S numbers and speaker labels, dropping and logging what does not match."""

    def __init__(self, rec_id: str, segments: list[SegmentRow], label_to_id: Mapping[str, str]) -> None:
        self.rec_id = rec_id
        self.segments = segments
        self.label_to_id = label_to_id

    def text(self, text: str) -> str:
        return tokenize_speakers(text, self.label_to_id)

    def citations(self, sources: Sequence[int], section: str, position: int) -> list[Citation]:
        citations: list[Citation] = []
        for s in dict.fromkeys(sources):
            if not 1 <= s <= len(self.segments):
                logger.warning(
                    "Dropped unknown source S%d from %s item %d of recording %s", s, section, position, self.rec_id
                )
                continue
            segment = self.segments[s - 1]
            citations.append(Citation(recording_id=self.rec_id, segment_id=segment.id, start_ms=segment.start_ms))
        if not citations:
            logger.warning(
                "Dropped %s item %d of recording %s: it is left without a valid source", section, position, self.rec_id
            )
        return citations

    def items(self, items: Sequence[Item], section: str) -> list[AnalysisItem]:
        kept: list[AnalysisItem] = []
        for position, item in enumerate(items, start=1):
            citations = self.citations(item.sources, section, position)
            if citations:
                kept.append(AnalysisItem(text=self.text(item.text), citations=citations))
        return kept

    def action_items(self, items: Sequence[ActionItem]) -> list[AnalysisActionItem]:
        kept: list[AnalysisActionItem] = []
        for position, item in enumerate(items, start=1):
            citations = self.citations(item.sources, "action", position)
            if not citations:
                continue
            owner = self.label_to_id.get(item.owner) if item.owner is not None else None
            if item.owner is not None and owner is None:
                # The label itself is model output, so it is not logged.
                logger.warning(
                    "Unknown owner on action item %d of recording %s; owner set to null", position, self.rec_id
                )
            kept.append(
                AnalysisActionItem(text=self.text(item.text), citations=citations, owner_speaker_id=owner, due=item.due)
            )
        return kept


def _content(analysis: MeetingAnalysis | NoteAnalysis, checker: _Checker) -> MeetingSummary | NoteContent:
    if isinstance(analysis, NoteAnalysis):
        return NoteContent(
            key_points=checker.items(analysis.key_points, "key point"), clean_text=checker.text(analysis.clean_text)
        )
    return MeetingSummary(
        overview=checker.text(analysis.overview),
        decisions=checker.items(analysis.decisions, "decision"),
        action_items=checker.action_items(analysis.action_items),
        open_questions=checker.items(analysis.open_questions, "open question"),
    )


def _replace_tags(conn: sqlite3.Connection, rec_id: str, names: Sequence[str]) -> None:
    conn.execute("DELETE FROM recording_tags WHERE recording_id = ?", (rec_id,))
    # Read after the first write, so the transaction already holds the write lock and a concurrent tag edit
    # cannot insert the same name between this read and the insert below.
    existing = {row["name"]: row["id"] for row in conn.execute("SELECT id, name FROM tags")}
    tag_ids: list[str] = []
    for name in (normalize_tag(name) for name in names):
        if not name:
            continue
        reused = match_existing_tag(name, existing.keys())
        if reused is None:
            tag_id = new_id("tag")
            conn.execute("INSERT INTO tags (id, name) VALUES (?, ?)", (tag_id, name))
            existing[name] = tag_id
        else:
            tag_id = existing[reused]
        if tag_id not in tag_ids:
            tag_ids.append(tag_id)
        if len(tag_ids) == MAX_TAGS:
            break
    conn.executemany(
        "INSERT INTO recording_tags (recording_id, tag_id) VALUES (?, ?)", [(rec_id, tag_id) for tag_id in tag_ids]
    )


def store_analysis(conn: sqlite3.Connection, rec_id: str, analysis: MeetingAnalysis | NoteAnalysis) -> None:
    """Writes the checked analysis, title and tags inside the caller's transaction; it never commits."""
    speakers = conn.execute("SELECT id, label FROM speakers WHERE recording_id = ?", (rec_id,))
    label_to_id = {row["label"]: row["id"] for row in speakers}
    checker = _Checker(rec_id, load_segment_rows(conn, rec_id), label_to_id)
    content = _content(analysis, checker)
    _replace_tags(conn, rec_id, analysis.tags)
    conn.execute(
        "UPDATE recordings SET title = ?, analysis = ? WHERE id = ?",
        (analysis.title, content.model_dump_json(), rec_id),
    )
