import sqlite3
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from app.agents.sources import ResolvedSource, SourceRegistry
from app.rag.retrieve import Hit


def test_registry_labels_and_resolve() -> None:
    registry = SourceRegistry()

    hit1 = Hit(
        recording_id="rec_1",
        recording_title="Meeting 1",
        kind="meeting",
        created_at="2026-10-17T00:00:00Z",
        first_segment_id="seg_1",
        start_ms=1000,
        end_ms=4000,
        text="First passage",
        distance=0.1,
    )
    hit2 = Hit(
        recording_id="rec_2",
        recording_title="Note 2",
        kind="note",
        created_at="2026-10-17T00:00:00Z",
        first_segment_id="seg_2",
        start_ms=2000,
        end_ms=5000,
        text="Second passage",
        distance=0.2,
    )

    p1 = registry.add_passage(hit1)
    p2 = registry.add_passage(hit2)
    assert p1 == "P1"
    assert p2 == "P2"

    rec_dict = {
        "recording_id": "rec_3",
        "recording_title": "Dict recording",
        "segment_id": "seg_3",
        "start_ms": 0,
    }
    r1 = registry.add_recording(rec_dict)
    assert r1 == "R1"

    rec_obj = SimpleNamespace(
        id="rec_4",
        title="Obj recording",
        first_segment_id="seg_4",
    )
    r2 = registry.add_recording(rec_obj)
    assert r2 == "R2"

    assert registry.resolve("P1") == ResolvedSource(
        recording_id="rec_1",
        segment_id="seg_1",
        start_ms=1000,
        recording_title="Meeting 1",
    )
    assert registry.resolve("[P1]") == registry.resolve("P1")
    assert registry.resolve("[ P1 ]") == registry.resolve("P1")
    assert registry.resolve("p1") == registry.resolve("P1")

    assert registry.resolve("R1") == ResolvedSource(
        recording_id="rec_3",
        segment_id="seg_3",
        start_ms=0,
        recording_title="Dict recording",
    )
    assert registry.resolve("R2") == ResolvedSource(
        recording_id="rec_4",
        segment_id="seg_4",
        start_ms=0,
        recording_title="Obj recording",
    )

    assert registry.resolve("P99") is None
    assert registry.resolve("R99") is None


def test_registry_add_recording_sqlite_row() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT 'rec_row' AS id, 'Row Title' AS title, 'seg_row' AS first_segment_id, 500 AS start_ms"
        ).fetchone()
        assert row is not None

        registry = SourceRegistry()
        r_label = registry.add_recording(row)
        assert r_label == "R1"
        resolved = registry.resolve(r_label)
        assert resolved == ResolvedSource(
            recording_id="rec_row",
            segment_id="seg_row",
            start_ms=500,
            recording_title="Row Title",
        )
    finally:
        conn.close()


def test_registry_threadsafe_unique_labels() -> None:
    registry = SourceRegistry()
    num_threads = 20
    items_per_thread = 10

    def worker(worker_id: int) -> tuple[list[str], list[str]]:
        passages: list[str] = []
        recordings: list[str] = []
        for i in range(items_per_thread):
            hit = Hit(
                recording_id=f"rec_{worker_id}_{i}",
                recording_title=f"Title {worker_id}_{i}",
                kind="meeting",
                created_at="2026-10-17T00:00:00Z",
                first_segment_id=f"seg_{worker_id}_{i}",
                start_ms=i * 1000,
                end_ms=(i + 1) * 1000,
                text=f"text {worker_id}_{i}",
                distance=0.1,
            )
            passages.append(registry.add_passage(hit))
            recordings.append(
                registry.add_recording(
                    {
                        "recording_id": f"rec_meta_{worker_id}_{i}",
                        "recording_title": f"Meta {worker_id}_{i}",
                        "segment_id": f"seg_meta_{worker_id}_{i}",
                    }
                )
            )
        return passages, recordings

    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        results = list(executor.map(worker, range(num_threads)))

    all_passages: list[str] = []
    all_recordings: list[str] = []
    for passages, recordings in results:
        all_passages.extend(passages)
        all_recordings.extend(recordings)

    total_expected = num_threads * items_per_thread
    assert len(all_passages) == total_expected
    assert len(set(all_passages)) == total_expected
    assert len(all_recordings) == total_expected
    assert len(set(all_recordings)) == total_expected

    for p in all_passages:
        resolved = registry.resolve(p)
        assert resolved is not None
        assert resolved.segment_id.startswith("seg_")

    for r in all_recordings:
        resolved = registry.resolve(r)
        assert resolved is not None
        assert resolved.recording_id.startswith("rec_meta_")
