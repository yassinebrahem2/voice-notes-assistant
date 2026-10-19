"""Factory and container parts for n8n mode."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.config import ConfigError
from app.n8n.analyzer import N8nAnalyzer
from app.n8n.client import N8nClient, first_gemini_entry
from app.n8n.embedder import N8nEmbedder
from app.n8n.settings import N8nSettings, shared_secret

if TYPE_CHECKING:
    from pydantic import SecretStr

    from app.config.models_registry import ModelsRegistry


@dataclass
class N8nParts:
    """Components initialized for n8n mode."""

    client: N8nClient
    analyzer: N8nAnalyzer
    embedder: N8nEmbedder
    secret: SecretStr


def build_n8n_parts(registry: ModelsRegistry) -> N8nParts:
    """Build and validate n8n mode components."""
    sec = shared_secret()
    if sec is None:
        raise ConfigError("N8N_SHARED_SECRET is required when AI_BACKEND=n8n")

    if first_gemini_entry(registry, registry.roles.llm) is None:
        raise ConfigError("No google_genai provider configured for llm role")

    if first_gemini_entry(registry, registry.roles.llm_analysis) is None:
        raise ConfigError("No google_genai provider configured for llm_analysis role")

    settings = N8nSettings()
    client = N8nClient(settings, sec)
    analyzer = N8nAnalyzer(registry, client)
    embedder = N8nEmbedder(client, settings.n8n_embed_model)
    return N8nParts(client=client, analyzer=analyzer, embedder=embedder, secret=sec)
