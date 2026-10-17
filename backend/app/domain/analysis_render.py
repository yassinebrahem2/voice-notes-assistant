"""Render speaker tokens in analysis outputs using current display names."""

from collections.abc import Mapping
from typing import overload

from app.domain.analysis import (
    AnalysisActionItem,
    AnalysisItem,
    MeetingSummary,
    NoteContent,
)
from app.domain.speakers import render_speakers


@overload
def render_analysis(analysis: MeetingSummary, id_to_display: Mapping[str, str]) -> MeetingSummary: ...


@overload
def render_analysis(analysis: NoteContent, id_to_display: Mapping[str, str]) -> NoteContent: ...


def render_analysis(
    analysis: MeetingSummary | NoteContent, id_to_display: Mapping[str, str]
) -> MeetingSummary | NoteContent:
    """Return a copy of the analysis with speaker tokens replaced by display names."""
    if isinstance(analysis, MeetingSummary):
        return MeetingSummary(
            overview=render_speakers(analysis.overview, id_to_display),
            decisions=[
                AnalysisItem(
                    text=render_speakers(item.text, id_to_display),
                    citations=list(item.citations),
                )
                for item in analysis.decisions
            ],
            action_items=[
                AnalysisActionItem(
                    text=render_speakers(item.text, id_to_display),
                    citations=list(item.citations),
                    owner_speaker_id=item.owner_speaker_id,
                    due=item.due,
                )
                for item in analysis.action_items
            ],
            open_questions=[
                AnalysisItem(
                    text=render_speakers(item.text, id_to_display),
                    citations=list(item.citations),
                )
                for item in analysis.open_questions
            ],
        )

    return NoteContent(
        key_points=[
            AnalysisItem(
                text=render_speakers(item.text, id_to_display),
                citations=list(item.citations),
            )
            for item in analysis.key_points
        ],
        clean_text=render_speakers(analysis.clean_text, id_to_display),
    )
