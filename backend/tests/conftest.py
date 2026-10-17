import os
from pathlib import Path
from typing import cast

import pytest
import yaml

from app.config.settings import Settings


@pytest.fixture(autouse=True)
def isolate_provider_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    # Dotenv mutates os.environ directly, so isolate the mapping itself as well as its keys.
    monkeypatch.setattr(os, "environ", os.environ.copy())
    # Tests must neither inherit machine-specific settings nor read a developer's dotenv file.
    for field in Settings.model_fields:
        for env_name in tuple(os.environ):
            if env_name.lower() == field:
                monkeypatch.delenv(env_name, raising=False)
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    registry_path = Path(__file__).resolve().parents[2] / "config" / "models.yaml"
    registry = cast(dict[str, dict[str, dict[str, str]]], yaml.safe_load(registry_path.read_text(encoding="utf-8")))
    for provider in registry["providers"].values():
        monkeypatch.delenv(provider["key_env"], raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
