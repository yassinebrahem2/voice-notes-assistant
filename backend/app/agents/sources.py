"""Source registry tracking passages and recordings with sequential run-scoped labels."""

from collections.abc import Mapping
from dataclasses import dataclass
import sqlite3
import threading
from typing import cast

from app.rag.retrieve import Hit


def _extract(obj: object, *keys: str) -> object | None:
    if isinstance(obj, sqlite3.Row):
        for k in keys:
            if k in obj.keys():
                return cast(object, obj[k])
        return None
    if isinstance(obj, Mapping):
        mapping = cast(Mapping[str, object], obj)
        for k in keys:
            if k in mapping:
                return mapping[k]
        return None
    for k in keys:
        if hasattr(obj, k):
            val = cast(object, getattr(obj, k))
            if val is not None:
                return val
    return None


@dataclass(frozen=True)
class ResolvedSource:
    recording_id: str
    segment_id: str
    start_ms: int
    recording_title: str


class SourceRegistry:
    """Thread-safe registry assigning sequential P1.. and R1.. labels within a chat run."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._passage_counter = 0
        self._recording_counter = 0
        self._sources: dict[str, ResolvedSource] = {}
        self.found_relevant: bool = False

    def add_passage(self, hit: Hit) -> str:
        with self._lock:
            self._passage_counter += 1
            label = f"P{self._passage_counter}"
            self._sources[label] = ResolvedSource(
                recording_id=hit.recording_id,
                segment_id=hit.first_segment_id,
                start_ms=hit.start_ms,
                recording_title=hit.recording_title,
            )
            return label

    def add_recording(self, rec: object) -> str:
        raw_id = _extract(rec, "recording_id", "id")
        rec_id = str(raw_id) if raw_id is not None else ""
        raw_title = _extract(rec, "recording_title", "title")
        rec_title = str(raw_title) if raw_title is not None else ""
        raw_seg = _extract(rec, "segment_id", "first_segment_id")
        seg_id = str(raw_seg) if raw_seg is not None else ""
        raw_start = _extract(rec, "start_ms")
        start_ms = int(raw_start) if isinstance(raw_start, int | str | float) else 0

        with self._lock:
            self._recording_counter += 1
            label = f"R{self._recording_counter}"
            self._sources[label] = ResolvedSource(
                recording_id=rec_id,
                segment_id=seg_id,
                start_ms=start_ms,
                recording_title=rec_title,
            )
            return label

    def resolve(self, label: str) -> ResolvedSource | None:
        norm = label.strip("[]").upper()
        with self._lock:
            return self._sources.get(norm)
