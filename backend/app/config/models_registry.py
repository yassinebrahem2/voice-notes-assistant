"""Validated, role-based model configuration without secret values."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import yaml
from pydantic import BaseModel, Field, HttpUrl, ValidationError, model_validator

from app.config import ConfigError
from app.config.settings import Settings


class Provider(BaseModel):
    base_url: HttpUrl
    key_env: str = Field(min_length=1)


class LlmEntry(BaseModel):
    provider: str
    model: str
    reasoning: dict[str, str | int] = Field(default_factory=dict)
    max_request_tokens: int = Field(gt=0)
    timeout_s: float = Field(gt=0)


class LocalModel(BaseModel):
    model: str
    device: str
    compute_type: str | None = None


class Roles(BaseModel):
    llm: list[LlmEntry] = Field(min_length=1)
    llm_analysis: list[LlmEntry] = Field(min_length=1)
    embedder: LocalModel
    asr: LocalModel
    diarizer: LocalModel


class ModelsRegistry(BaseModel):
    providers: dict[str, Provider]
    roles: Roles

    @model_validator(mode="after")
    def validate_providers(self) -> ModelsRegistry:
        for name, provider in self.providers.items():
            if provider.base_url.username is not None or provider.base_url.password is not None:
                raise ConfigError(f"Provider {name} base_url must not contain credentials")
            if provider.base_url.query is not None or provider.base_url.fragment is not None:
                raise ConfigError(f"Provider {name} base_url must not contain a query or fragment")
        for role_name in ("llm", "llm_analysis"):
            entries: list[LlmEntry] = getattr(self.roles, role_name)
            for entry in entries:
                if entry.provider not in self.providers:
                    raise ConfigError(f"Role {role_name} references unknown provider {entry.provider}")
        return self


def load_models_registry(path: Path, settings: Settings) -> ModelsRegistry:
    try:
        document = cast(object, yaml.safe_load(path.read_text(encoding="utf-8")))
        registry = ModelsRegistry.model_validate(document)
    except ValidationError as error:
        fields = ", ".join(".".join(map(str, item["loc"])) or "document" for item in error.errors())
        raise ConfigError(f"Invalid models config fields: {fields}") from None
    except (OSError, UnicodeError, yaml.YAMLError):
        raise ConfigError("Cannot read models config") from None
    if settings.asr_device is not None:
        registry.roles.asr.device = settings.asr_device
        if settings.asr_device == "cpu":
            registry.roles.asr.compute_type = "int8"
    if settings.diarizer_device is not None:
        registry.roles.diarizer.device = settings.diarizer_device
    return registry
