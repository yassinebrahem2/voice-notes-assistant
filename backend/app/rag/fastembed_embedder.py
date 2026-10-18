import threading
from collections.abc import Sequence
from pathlib import Path

from fastembed import TextEmbedding
from huggingface_hub.file_download import repo_folder_name

# BGE's query instruction; fastembed 0.9's query_embed does not add it.
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def model_files_cached(model_id: str, cache_dir: Path) -> bool:
    """Whether fastembed would load `model_id` from `cache_dir` without downloading it."""
    description = next(
        (model for model in TextEmbedding.list_supported_models() if model["model"].lower() == model_id.lower()),
        None,
    )
    if description is None or description["sources"]["hf"] is None:
        return False
    # fastembed downloads through the Hugging Face hub cache, which resolves the branch through refs/main.
    repo_dir = cache_dir / repo_folder_name(repo_id=description["sources"]["hf"], repo_type="model")
    ref = repo_dir / "refs" / "main"
    if not ref.is_file():
        return False
    snapshot = repo_dir / "snapshots" / ref.read_text(encoding="utf-8").strip()
    required: list[str] = [description["model_file"], *description["additional_files"]]
    return all((snapshot / name).is_file() for name in required)


class FastEmbedEmbedder:
    dim = 384

    def __init__(self, model_id: str, cache_dir: Path) -> None:
        self.model_id = model_id
        self.cache_dir = cache_dir
        # Created on first use: building the container must not download or load the model.
        self._model: TextEmbedding | None = None
        self._lock = threading.Lock()

    def is_cached(self) -> bool:
        return model_files_cached(self.model_id, self.cache_dir)

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(value) for value in vector] for vector in self._text_embedding().embed(list(texts))]

    def embed_query(self, text: str) -> list[float]:
        return self.embed_passages([QUERY_PREFIX + text])[0]

    def _text_embedding(self) -> TextEmbedding:
        with self._lock:
            if self._model is None:
                self._model = TextEmbedding(model_name=self.model_id, cache_dir=str(self.cache_dir))
            return self._model
