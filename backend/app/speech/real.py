"""The real ASR and diarizer: each call runs its speech child and validates the JSON it returns.

This module imports nothing heavy, because the container and `/health` import it where torch is not installed.
Which files a model needs is known only to its library, so `setup` downloads through the library and records the
files it got (`record_download`); readiness then checks that those files are still in the cache.
"""

import importlib.util
import json
import os
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config.models_registry import ModelsRegistry
from app.config.settings import Settings
from app.speech.child import ChildOutputError, run_child
from app.speech.protocols import AsrSegment, DiarTurn

SpeechRole = Literal["asr", "diarizer"]

DOWNLOADS_FILE = "speech-downloads.json"


def speech_extra_installed() -> bool:
    """Whether the speech packages are importable, checked without importing them (and so without torch)."""
    names = ("faster_whisper", "pyannote", "torch")
    return all(importlib.util.find_spec(name) is not None for name in names) and (
        importlib.util.find_spec("pyannote.audio") is not None
    )


def hf_home(model_cache_dir: Path) -> Path:
    """The `HF_HOME` every speech child gets; the hub cache is its `hub` folder."""
    return model_cache_dir / "hf"


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")


class _ChildSegment(_Strict):
    start_ms: int
    end_ms: int
    text: str


class _ChildTurn(_Strict):
    start_ms: int
    end_ms: int
    speaker: str


class _AsrResult(_Strict):
    segments: list[_ChildSegment]


class _DiarizerResult(_Strict):
    turns: list[_ChildTurn]


class _Download(_Strict):
    model: str
    files: list[str] = Field(min_length=1)


def _read_downloads(model_cache_dir: Path) -> dict[str, object]:
    try:
        data = cast(object, json.loads((hf_home(model_cache_dir) / DOWNLOADS_FILE).read_text(encoding="utf-8")))
    except (OSError, UnicodeError, ValueError):
        return {}
    return cast(dict[str, object], data) if isinstance(data, dict) else {}


def record_download(model_cache_dir: Path, role: SpeechRole, model: str, snapshot: Path) -> None:
    """Records every file under `snapshot` as what `role` needs to run `model` offline."""
    home = hf_home(model_cache_dir)
    files = sorted(path.relative_to(home).as_posix() for path in snapshot.rglob("*") if path.is_file())
    downloads = _read_downloads(model_cache_dir)
    downloads[role] = {"model": model, "files": files}
    home.mkdir(parents=True, exist_ok=True)
    (home / DOWNLOADS_FILE).write_text(json.dumps(downloads, indent=2, sort_keys=True), encoding="utf-8")


def model_downloaded(model_cache_dir: Path, role: SpeechRole, model: str) -> bool:
    """Whether `setup` downloaded `model` for `role` and every file it got is still there (no model loading)."""
    try:
        download = _Download.model_validate(_read_downloads(model_cache_dir).get(role))
    except ValidationError:
        return False
    home = hf_home(model_cache_dir)
    return download.model == model and all((home / name).is_file() for name in download.files)


def _child_env(settings: Settings) -> dict[str, str]:
    # The full environment, read at each call: Windows children need SYSTEMROOT, and serve sets HF_HUB_OFFLINE
    # after the container is built; PATH, CUDA variables and HF_TOKEN come through the same way.
    return {**os.environ, "HF_HOME": str(hf_home(settings.model_cache_dir)), "PYANNOTE_METRICS_ENABLED": "false"}


class RealAsr:
    def __init__(self, models: ModelsRegistry, settings: Settings) -> None:
        self.models = models
        self.settings = settings

    def is_cached(self) -> bool:
        return model_downloaded(self.settings.model_cache_dir, "asr", self.models.roles.asr.model)

    def transcribe(self, audio_npy: Path) -> list[AsrSegment]:
        role = self.models.roles.asr
        args = ["--audio", str(audio_npy), "--model", role.model, "--device", role.device]
        # faster-whisper's own default when models.yaml names no compute type.
        args += ["--compute", role.compute_type or "default"]
        data = run_child(
            "app.speech.asr_child", args, timeout_s=self.settings.speech_step_timeout_s, env=_child_env(self.settings)
        )
        try:
            result = _AsrResult.model_validate(data)
        except ValidationError:
            raise ChildOutputError("ASR child result has the wrong shape") from None
        return [AsrSegment(item.start_ms, item.end_ms, item.text) for item in result.segments]


class RealDiarizer:
    def __init__(self, models: ModelsRegistry, settings: Settings) -> None:
        self.models = models
        self.settings = settings

    def is_cached(self) -> bool:
        return model_downloaded(self.settings.model_cache_dir, "diarizer", self.models.roles.diarizer.model)

    def diarize(self, audio_npy: Path) -> list[DiarTurn]:
        role = self.models.roles.diarizer
        args = ["--audio", str(audio_npy), "--model", role.model, "--device", role.device]
        data = run_child(
            "app.speech.diarize_child",
            args,
            timeout_s=self.settings.speech_step_timeout_s,
            env=_child_env(self.settings),
        )
        try:
            result = _DiarizerResult.model_validate(data)
        except ValidationError:
            raise ChildOutputError("Diarizer child result has the wrong shape") from None
        return [DiarTurn(item.start_ms, item.end_ms, item.speaker) for item in result.turns]
