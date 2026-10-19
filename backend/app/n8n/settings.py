"""Settings and shared secret loader for n8n mode."""

from __future__ import annotations

import os

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class N8nSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    n8n_url: str = "http://127.0.0.1:5678"
    n8n_timeout_s: float = 60.0
    n8n_embed_model: str = "gemini-embedding-001"


def shared_secret() -> SecretStr | None:
    value = os.environ.get("N8N_SHARED_SECRET")
    return SecretStr(value) if value else None
