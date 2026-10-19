"""Embedder calling n8n embed webhook."""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from app.n8n.client import N8nBadResponse, N8nClient


class N8nEmbedder:
    """Embedder producing 768-dim vectors through n8n with Gemini."""

    dim: int = 768

    def __init__(self, client: N8nClient, model: str) -> None:
        self.client = client
        self.model = model

    def _validate_vector(self, item: object) -> list[float]:
        if not isinstance(item, list):
            raise N8nBadResponse("Vector must be a list")
        raw_list = cast(list[object], item)
        if len(raw_list) != self.dim:
            raise N8nBadResponse(f"Expected vector of length {self.dim}")
        result: list[float] = []
        for x in raw_list:
            if not isinstance(x, (int, float)):
                raise N8nBadResponse("Vector elements must be numbers")
            result.append(float(x))
        return result

    def _parse_vectors(self, reply: dict[str, object], expected_count: int) -> list[list[float]]:
        vectors = reply.get("vectors")
        if not isinstance(vectors, list):
            raise N8nBadResponse(f"Expected list of vectors, got {vectors}")
        raw_vectors = cast(list[object], vectors)
        if len(raw_vectors) != expected_count:
            raise N8nBadResponse(f"Expected {expected_count} vectors, got {len(raw_vectors)}")
        return [self._validate_vector(v) for v in raw_vectors]

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        batch_size = 100
        results: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = list(texts[i : i + batch_size])
            reply = self.client.post(
                "embed",
                {
                    "model": self.model,
                    "texts": batch,
                    "task": "RETRIEVAL_DOCUMENT",
                },
            )
            results.extend(self._parse_vectors(reply, len(batch)))
        return results

    def embed_query(self, text: str) -> list[float]:
        reply = self.client.post(
            "embed",
            {
                "model": self.model,
                "texts": [text],
                "task": "RETRIEVAL_QUERY",
            },
        )
        vectors = self._parse_vectors(reply, 1)
        return vectors[0]
