"""Binary serialization of embeddings for sqlite-vec."""

import struct
from collections.abc import Sequence


def pack_embedding(vec: Sequence[float]) -> bytes:
    """Pack a float sequence into little-endian float32 bytes for sqlite-vec."""
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_embedding(blob: bytes) -> list[float]:
    """Unpack little-endian float32 bytes into a list of floats."""
    if len(blob) % 4 != 0:
        raise ValueError(f"Embedding blob length {len(blob)} is not a multiple of 4")
    count = len(blob) // 4
    return list(struct.unpack(f"<{count}f", blob))
