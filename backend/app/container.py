from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from app.agents.summarizer import SummarizerAnalyzer
from app.config.app_config import AppConfig, load_app_config
from app.config.models_registry import ModelsRegistry, load_models_registry
from app.config.settings import Settings
from app.processing.protocols import Analyzer
from app.rag.fastembed_embedder import FastEmbedEmbedder
from app.rag.protocols import Embedder
from app.speech.fakes import FakeAsr, FakeDiarizer
from app.speech.protocols import Asr, Diarizer
from app.speech.real import RealAsr, RealDiarizer

if TYPE_CHECKING:
    # The worker imports this module, so a runtime import would be circular.
    from app.chats.runs import ChatRuns
    from app.n8n.wiring import N8nParts
    from app.processing.worker import Worker


@dataclass
class Container:
    settings: Settings
    app_config: AppConfig
    models: ModelsRegistry
    db_path: Path
    speech_backend_bound: Literal["real", "fake"]
    asr: Asr
    diarizer: Diarizer
    embedder: Embedder
    analyzer: Analyzer
    worker: "Worker | None" = None
    chat_runs: "ChatRuns | None" = None
    n8n: "N8nParts | None" = None


def build_container(settings: Settings) -> Container:
    config_dir = Path(__file__).resolve().parents[2] / "config"
    app_config = load_app_config(config_dir / "app.json")
    models = load_models_registry(config_dir / "models.yaml", settings)
    asr: Asr
    diarizer: Diarizer
    if settings.speech_backend == "real":
        # Constructing them runs nothing: each call starts its own child process.
        asr, diarizer = RealAsr(models, settings), RealDiarizer(models, settings)
    else:
        asr, diarizer = FakeAsr(), FakeDiarizer()

    if settings.ai_backend == "n8n":
        from app.chats.runs import ChatRuns
        from app.n8n.chat_graph import build_n8n_chat_graph
        from app.n8n.wiring import build_n8n_parts

        n8n_parts = build_n8n_parts(models)
        container = Container(
            settings,
            app_config,
            models,
            settings.data_dir / "app.db",
            settings.speech_backend,
            asr,
            diarizer,
            n8n_parts.embedder,
            n8n_parts.analyzer,
            n8n=n8n_parts,
        )
        container.chat_runs = ChatRuns(container, build_n8n_chat_graph)
        return container
    else:
        embedder = FastEmbedEmbedder(models.roles.embedder.model, settings.model_cache_dir)
        analyzer = SummarizerAnalyzer(models)
        container = Container(
            settings,
            app_config,
            models,
            settings.data_dir / "app.db",
            settings.speech_backend,
            asr,
            diarizer,
            embedder,
            analyzer,
        )
        from app.agents.chat_graph import build_chat_graph
        from app.chats.runs import ChatRuns

        container.chat_runs = ChatRuns(container, build_chat_graph)
        return container
