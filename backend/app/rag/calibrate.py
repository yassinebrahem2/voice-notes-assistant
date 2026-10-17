"""Relevance calibration tool to find optimal retrieval_max_distance threshold."""

from __future__ import annotations

import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, TextIO, cast, overload

import yaml
from pydantic import BaseModel, Field, ValidationError, model_validator

from app.db.connection import connect
from app.rag.protocols import Embedder
from app.rag.vectors import pack_embedding

if TYPE_CHECKING:
    from app.container import Container


class QuestionItem(BaseModel):
    text: str = Field(min_length=1)
    expect_recording_title: str | None = None
    unrelated: bool = False

    @model_validator(mode="after")
    def validate_expect_or_unrelated(self) -> QuestionItem:
        has_title = bool(self.expect_recording_title and self.expect_recording_title.strip())
        is_unrelated = bool(self.unrelated)
        if has_title == is_unrelated:
            raise ValueError("QuestionItem must specify exactly one of expect_recording_title or unrelated: true")
        return self


class CalibrationYaml(BaseModel):
    questions: list[QuestionItem]


@dataclass
class ExpectedQuestionResult:
    text: str
    expected_title: str
    best_expected_distance: float | None
    top_hit_title: str
    top_hit_distance: float


@dataclass
class UnrelatedQuestionResult:
    text: str
    top_hit_title: str
    top_hit_distance: float


@dataclass
class CalibrationResult:
    expected_results: list[ExpectedQuestionResult]
    unrelated_results: list[UnrelatedQuestionResult]
    max_expected_distance: float
    min_unrelated_distance: float
    has_overlap: bool
    margin: float
    suggested_threshold: float


def calibrate_retrieval(
    conn: sqlite3.Connection,
    embedder: Embedder,
    questions_file: Path,
) -> CalibrationResult:
    """Analyze retrieval distances for calibration questions and suggest distance threshold."""
    if not questions_file.is_file():
        raise FileNotFoundError(f"Questions file not found: {questions_file}")

    try:
        raw_content = yaml.safe_load(questions_file.read_text(encoding="utf-8"))
    except Exception as err:
        raise ValueError(f"Failed to parse YAML file '{questions_file}': {err}") from err

    try:
        spec = CalibrationYaml.model_validate(raw_content)
    except ValidationError as err:
        raise ValueError(f"Invalid calibration questions schema in '{questions_file}': {err}") from err

    # Check if database has ready recordings with chunks
    count_row = conn.execute(
        """
        SELECT COUNT(*) FROM chunks c
        JOIN recordings r ON r.id = c.recording_id
        WHERE r.status = 'ready'
        """
    ).fetchone()
    chunk_count = count_row[0] if count_row else 0
    if chunk_count == 0:
        raise ValueError("No ready recording chunks found in database. Seed demo recordings first.")

    expected_results: list[ExpectedQuestionResult] = []
    unrelated_results: list[UnrelatedQuestionResult] = []

    for q in spec.questions:
        if not q.unrelated and not q.expect_recording_title:
            raise ValueError(f"Question '{q.text}' must specify either expect_recording_title or unrelated: true")

        query_blob = pack_embedding(embedder.embed_query(q.text))
        rows = conn.execute(
            """
            SELECT
                c.recording_id,
                COALESCE(r.title, '') AS recording_title,
                vec_distance_cosine(c.embedding, :query_blob) AS distance
            FROM chunks c
            JOIN recordings r ON r.id = c.recording_id
            WHERE r.status = 'ready'
            ORDER BY distance ASC
            """,
            {"query_blob": query_blob},
        ).fetchall()

        if not rows:
            raise ValueError("No chunks returned from query.")

        top_hit_title = str(rows[0]["recording_title"])
        top_hit_distance = float(rows[0]["distance"])

        if q.unrelated:
            unrelated_results.append(
                UnrelatedQuestionResult(
                    text=q.text,
                    top_hit_title=top_hit_title,
                    top_hit_distance=top_hit_distance,
                )
            )
        else:
            exp_title = q.expect_recording_title or ""
            matching_distances = [
                float(row["distance"])
                for row in rows
                if str(row["recording_title"]).strip().lower() == exp_title.strip().lower()
            ]
            best_exp_dist = min(matching_distances) if matching_distances else None
            expected_results.append(
                ExpectedQuestionResult(
                    text=q.text,
                    expected_title=exp_title,
                    best_expected_distance=best_exp_dist,
                    top_hit_title=top_hit_title,
                    top_hit_distance=top_hit_distance,
                )
            )

    valid_expected = [r.best_expected_distance for r in expected_results if r.best_expected_distance is not None]
    max_expected = round(max(valid_expected), 3) if valid_expected else 0.0

    unrelated_distances = [r.top_hit_distance for r in unrelated_results]
    min_unrelated = round(min(unrelated_distances), 3) if unrelated_distances else 1.0

    has_overlap = max_expected >= min_unrelated if (valid_expected and unrelated_distances) else False
    margin = round(min_unrelated - max_expected, 3)
    suggested_threshold = round((max_expected + min_unrelated) / 2.0, 3)

    return CalibrationResult(
        expected_results=expected_results,
        unrelated_results=unrelated_results,
        max_expected_distance=max_expected,
        min_unrelated_distance=min_unrelated,
        has_overlap=has_overlap,
        margin=margin,
        suggested_threshold=suggested_threshold,
    )


def format_calibration_report(result: CalibrationResult) -> str:
    """Format calibration results into a clean human-readable summary report."""
    lines: list[str] = [
        "=== Retrieval Calibration Report ===",
        f"Questions evaluated: {len(result.expected_results) + len(result.unrelated_results)} "
        f"({len(result.expected_results)} expected, {len(result.unrelated_results)} unrelated)\n",
    ]

    if result.expected_results:
        lines.append("Expected Questions:")
        for exp in result.expected_results:
            if exp.best_expected_distance is not None:
                match_str = f"Best matching distance: {exp.best_expected_distance:.3f}"
            else:
                match_str = "No chunk found from expected recording!"
            lines.append(f'  - "{exp.text}"')
            lines.append(
                f"    Expected: '{exp.expected_title}' | {match_str} | "
                f"Top hit: '{exp.top_hit_title}' ({exp.top_hit_distance:.3f})"
            )
        lines.append(f"  Max expected hit distance: {result.max_expected_distance:.3f}\n")

    if result.unrelated_results:
        lines.append("Unrelated Questions:")
        for un in result.unrelated_results:
            lines.append(f'  - "{un.text}"')
            lines.append(f"    Best hit: '{un.top_hit_title}' ({un.top_hit_distance:.3f})")
        lines.append(f"  Min unrelated hit distance: {result.min_unrelated_distance:.3f}\n")

    lines.append("Separation Analysis:")
    if result.has_overlap:
        lines.append(
            f"  WARNING: Overlap detected! Max expected distance ({result.max_expected_distance:.3f}) "
            f">= min unrelated distance ({result.min_unrelated_distance:.3f})."
        )
        lines.append("  Recommendation:")
        lines.append(
            f"  - For high recall (keep all expected): set retrieval_max_distance = {result.max_expected_distance:.3f}"
        )
        lines.append(
            f"  - For high precision (drop all unrelated): set retrieval_max_distance = "
            f"{result.min_unrelated_distance:.3f}"
        )
        lines.append(f"  - Balanced compromise: set retrieval_max_distance = {result.suggested_threshold:.3f}")
    else:
        lines.append(
            f"  Clean separation with margin: {result.margin:.3f} "
            f"({result.max_expected_distance:.3f} < {result.min_unrelated_distance:.3f})"
        )
        lines.append(f"  Suggested retrieval_max_distance: {result.suggested_threshold:.3f}")

    return "\n".join(lines) + "\n"


@overload
def run_calibration(
    target: Container,
    arg2: Path | str,
    arg3: None = None,
    *,
    out_stream: TextIO | None = None,
) -> int: ...


@overload
def run_calibration(
    target: sqlite3.Connection,
    arg2: Embedder,
    arg3: Path,
    *,
    out_stream: TextIO | None = None,
) -> int: ...


def run_calibration(
    target: sqlite3.Connection | Container,
    arg2: Embedder | Path | str,
    arg3: Path | None = None,
    *,
    out_stream: TextIO | None = None,
) -> int:
    """Run calibration from CLI or test and print results.

    Supports:
        run_calibration(container, questions_file)
        run_calibration(conn, embedder, questions_file)
    """
    out = out_stream or sys.stdout
    close_conn = False

    if isinstance(target, sqlite3.Connection):
        if arg3 is None:
            out.write("Error: embedder and questions file must be specified.\n")
            return 1
        conn = target
        embedder: Embedder = cast(Embedder, arg2)
        questions_file: Path = arg3
    else:
        conn = connect(target.db_path)
        embedder = target.embedder
        questions_file = Path(arg2) if isinstance(arg2, (str, Path)) else Path()
        close_conn = True

    try:
        result = calibrate_retrieval(conn, embedder, questions_file)
        report = format_calibration_report(result)
        out.write(report)
        return 0
    except Exception as err:
        out.write(f"Error during calibration: {err}\n")
        return 1
    finally:
        if close_conn:
            conn.close()
