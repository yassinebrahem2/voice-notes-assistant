from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from app.config.app_config import AppConfig, load_app_config
from app.config.models_registry import ModelsRegistry, load_models_registry
from app.config.settings import Settings
from app.processing.fakes import FakeAnalyzer
from app.processing.protocols import Analyzer
from app.rag.fakes import FakeEmbedder
from app.rag.protocols import Embedder
from app.speech.fakes import FakeAsr, FakeDiarizer
from app.speech.protocols import Asr, Diarizer

if TYPE_CHECKING:
    # The worker imports this module, so a runtime import would be circular.
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


def build_container(settings: Settings) -> Container:
    config_dir = Path(__file__).resolve().parents[2] / "config"
    app_config = load_app_config(config_dir / "app.json")
    models = load_models_registry(config_dir / "models.yaml", settings)
    # The processing plan binds real speech and embeddings here for speech_backend="real".
    asr, diarizer, embedder = FakeAsr(), FakeDiarizer(), FakeEmbedder()
    # The agents plan binds the real analyzer here.
    analyzer = FakeAnalyzer()
    return Container(
        settings, app_config, models, settings.data_dir / "app.db", "fake", asr, diarizer, embedder, analyzer
    )
