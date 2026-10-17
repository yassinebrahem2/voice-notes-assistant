"""Environment settings and the only access points for provider secrets."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from dotenv import load_dotenv
from platformdirs import user_data_dir
from pydantic import Field, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.config import ENV_FILE, ConfigError
from app.config.app_config import AppConfig, load_app_config

if TYPE_CHECKING:
    from app.config.models_registry import ModelsRegistry


def _data_dir(app: AppConfig) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", app.name.lower()).strip("-")
    return Path(user_data_dir(slug))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    data_dir: Path = Field(default_factory=lambda: _data_dir(load_app_config()))
    model_cache_dir: Path = Field(default_factory=lambda data: Path(data["data_dir"]) / "models")
    bind_host: str = "127.0.0.1"
    port: int = 8000
    speech_backend: Literal["real", "fake"] = "real"
    upload_max_bytes: int = 200_000_000
    chunk_max_tokens: int = 200
    chunk_min_tokens_at_speaker_change: int = 80
    retrieval_k: int = 8
    retrieval_max_distance: float = 0.6
    chat_deadline_s: float = 75
    speech_step_timeout_s: float = 1800
    asr_device: str | None = None
    diarizer_device: str | None = None


def load_settings(app: AppConfig, env_file: Path = ENV_FILE) -> Settings:
    try:
        load_dotenv(env_file, override=False)
        if not any(name.lower() == "data_dir" for name in os.environ):
            # pydantic-settings supports _env_file; Pydantic's generated signature omits it.
            return Settings(_env_file=None, data_dir=_data_dir(app))  # pyright: ignore[reportCallIssue]
        return Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
    except ValidationError as error:
        fields = ", ".join(".".join(map(str, item["loc"])) for item in error.errors())
        raise ConfigError(f"Invalid settings fields: {fields}") from None
    except (OSError, UnicodeError):
        raise ConfigError("Cannot read environment config") from None


def provider_key(registry: ModelsRegistry, provider: str) -> SecretStr | None:
    value = os.environ.get(registry.providers[provider].key_env)
    return SecretStr(value) if value else None


def hf_token() -> SecretStr | None:
    value = os.environ.get("HF_TOKEN")
    return SecretStr(value) if value else None
