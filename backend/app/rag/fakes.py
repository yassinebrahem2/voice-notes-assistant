import hashlib
import math
from collections.abc import Sequence


class FakeEmbedder:
    dim = 384

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        return [self.embed_query(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        # SHAKE is stable across processes and platforms, unlike Python's salted hash.
        digest = hashlib.shake_256(text.encode("utf-8")).digest(self.dim * 2)
        values = [int.from_bytes(digest[index : index + 2], "big") - 32767.5 for index in range(0, len(digest), 2)]
        norm = math.sqrt(sum(value * value for value in values))
        return [value / norm for value in values]
