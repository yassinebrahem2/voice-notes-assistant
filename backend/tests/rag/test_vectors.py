import math
from pathlib import Path

from app.db.connection import connect
from app.rag.vectors import pack_embedding, unpack_embedding


def test_pack_unpack_round_trip() -> None:
    vec = [0.0, 1.5, -2.25, 3.1415927]
    packed = pack_embedding(vec)
    unpacked = unpack_embedding(packed)
    assert len(unpacked) == len(vec)
    for a, b in zip(vec, unpacked, strict=True):
        assert math.isclose(a, b, rel_tol=1e-6)


def test_packed_vector_works_with_vec_distance_cosine(tmp_path: Path) -> None:
    conn = connect(tmp_path / "vec.sqlite3")
    try:
        vec = [1.0, 2.0, 3.0]
        blob = pack_embedding(vec)
        row = conn.execute("SELECT vec_distance_cosine(?, ?)", (blob, blob)).fetchone()
        assert row is not None
        assert math.isclose(row[0], 0.0, abs_tol=1e-5)
    finally:
        conn.close()
