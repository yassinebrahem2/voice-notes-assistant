import os
from pathlib import Path
from uuid import uuid4

import pytest

from app.config import CONFIG_DIR, ConfigError
from app.config.app_config import AppConfig
from app.config.models_registry import load_models_registry
from app.config.settings import Settings, hf_token, load_settings, provider_key


def test_env_file_reaches_os_environ(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry = load_models_registry(CONFIG_DIR / "models.yaml", Settings())
    key_env = registry.providers[registry.roles.llm[0].provider].key_env
    monkeypatch.delenv(key_env, raising=False)
    # Register restoration before load_dotenv writes to the environment.
    monkeypatch.setattr(os, "environ", os.environ.copy())
    value = uuid4().hex
    path = tmp_path / ".env"
    path.write_text(f"{key_env}={value}\nPORT=8123\n", encoding="utf-8")
    monkeypatch.setenv("PORT", "8124")
    settings = load_settings(AppConfig(name="Test", version="1"), path)
    key = provider_key(registry, registry.roles.llm[0].provider)
    assert key is not None and key.get_secret_value() == value
    assert settings.port == 8124
    assert all(value not in repr(obj) for obj in (key, settings, registry))
    monkeypatch.setenv(key_env, "override")
    load_settings(AppConfig(name="Test", version="1"), path)
    assert os.environ[key_env] == "override"


def test_settings_defaults_bind_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BIND_HOST", raising=False)
    assert Settings().bind_host == "127.0.0.1"


def test_settings_uses_app_data_and_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "runtime"))
    monkeypatch.delenv("MODEL_CACHE_DIR", raising=False)
    settings = load_settings(AppConfig(name="Test", version="1"), tmp_path / ".env")
    assert settings.model_cache_dir == settings.data_dir / "models"


def test_secret_readers_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = load_models_registry(CONFIG_DIR / "models.yaml", Settings())
    for provider in registry.providers.values():
        monkeypatch.delenv(provider.key_env, raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert provider_key(registry, registry.roles.llm[0].provider) is None
    assert hf_token() is None


def test_invalid_settings_are_sanitized(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT", "private-value")
    with pytest.raises(ConfigError) as caught:
        load_settings(AppConfig(name="Test", version="1"), tmp_path / ".env")
    assert "private-value" not in str(caught.value)


def test_data_dir_defaults_to_custom_app_slug(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("MODEL_CACHE_DIR", raising=False)
    slugs: list[str] = []

    def user_data_dir(appname: str) -> str:
        slugs.append(appname)
        return str(tmp_path / appname)

    monkeypatch.setattr("app.config.settings.user_data_dir", user_data_dir)
    settings = load_settings(AppConfig(name="Custom App Name", version="1"), tmp_path / ".env")
    assert slugs == ["custom-app-name"]
    assert settings.data_dir == tmp_path / "custom-app-name"
    assert settings.model_cache_dir == settings.data_dir / "models"


def test_custom_env_file_does_not_read_default_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.setattr(os, "environ", os.environ.copy())
    path = tmp_path / ".env"
    path.write_text("PORT=8127\n", encoding="utf-8")
    settings = load_settings(AppConfig(name="Test", version="1"), path)
    assert settings.port == 8127


def test_hf_token_is_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    value = uuid4().hex
    monkeypatch.setenv("HF_TOKEN", value)
    token = hf_token()
    assert token is not None and token.get_secret_value() == value
    assert value not in repr(token)


@pytest.mark.parametrize("env_name", ["data_dir", "DaTa_DiR", "DATA_DIR"])
def test_data_dir_environment_name_is_case_insensitive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, env_name: str
) -> None:
    # Windows uppercases os.environ keys; a plain dict also exercises POSIX behavior there.
    environment = dict(os.environ)
    environment[env_name] = str(tmp_path / "configured-data")
    monkeypatch.setattr(os, "environ", environment)
    settings = load_settings(AppConfig(name="Test", version="1"), tmp_path / "missing.env")
    assert settings.data_dir == tmp_path / "configured-data"
    assert settings.model_cache_dir == settings.data_dir / "models"
