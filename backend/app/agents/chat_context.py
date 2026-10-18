"""Chat execution context passed to agents, middleware, and tools."""

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from app.agents.sources import SourceRegistry
from app.config.models_registry import ModelsRegistry
from app.config.settings import Settings

if TYPE_CHECKING:
    from app.rag.protocols import Embedder
else:
    Embedder = Any


@dataclass
class ChatContext:
    db_path: Path
    embedder: Embedder
    settings: Settings
    models: ModelsRegistry
    scope: Literal["notes", "meetings", "both"]
    tag_ids: list[str]
    today: date
    sources: SourceRegistry
