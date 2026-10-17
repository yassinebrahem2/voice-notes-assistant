from pathlib import Path

import pytest

from app.config import CONFIG_DIR, ConfigError
from app.config.models_registry import load_models_registry
from app.config.settings import Settings


def test_registry_loads_repo_models_yaml() -> None:
    registry = load_models_registry(CONFIG_DIR / "models.yaml", Settings())
    assert registry.roles.llm[0].provider == "groq"


def test_asr_device_override_cpu() -> None:
    registry = load_models_registry(CONFIG_DIR / "models.yaml", Settings(asr_device="cpu"))
    assert registry.roles.asr.device == "cpu"
    assert registry.roles.asr.compute_type == "int8"


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        ("https://api.groq.com/openai/v1", "https://user:password@x.io/v1", "groq"),
        ("  llm_analysis:", "  missing_role:", "llm_analysis"),
        ("provider: groq", "provider: unknown", "unknown"),
        ("  llm_analysis:", "  llm_analysis: []\n  unused:", "llm_analysis"),
    ],
)
def test_registry_rejects_invalid_config(tmp_path: Path, old: str, new: str, message: str) -> None:
    path = tmp_path / "models.yaml"
    path.write_text((CONFIG_DIR / "models.yaml").read_text(encoding="utf-8").replace(old, new), encoding="utf-8")
    with pytest.raises(ConfigError, match=message) as caught:
        load_models_registry(path, Settings())
    assert "password" not in str(caught.value)


def test_malformed_yaml_is_sanitized(tmp_path: Path) -> None:
    path = tmp_path / "models.yaml"
    path.write_text("providers: [private-value: [", encoding="utf-8")
    with pytest.raises(ConfigError) as caught:
        load_models_registry(path, Settings())
    assert "private-value" not in str(caught.value)


def test_diarizer_override_does_not_change_embedder() -> None:
    registry = load_models_registry(CONFIG_DIR / "models.yaml", Settings(diarizer_device="cpu"))
    assert registry.roles.diarizer.device == "cpu"
    assert registry.roles.embedder.device == "cpu"
    assert registry.roles.asr.device == "cuda"


@pytest.mark.parametrize(
    "url",
    [
        "https://user@x.io/v1",
        "https://:private-value@x.io/v1",
        "not-a-url",
        "https://x.io/v1?api_key=private-value",
        "https://x.io/v1#private-value",
    ],
)
def test_invalid_provider_url_never_appears_in_error(tmp_path: Path, url: str) -> None:
    path = tmp_path / "models.yaml"
    path.write_text(
        (CONFIG_DIR / "models.yaml").read_text(encoding="utf-8").replace("https://api.groq.com/openai/v1", url),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError) as caught:
        load_models_registry(path, Settings())
    assert "groq" in str(caught.value)
    assert url not in str(caught.value)


def test_openai_without_base_url_raises_config_error(tmp_path: Path) -> None:
    path = tmp_path / "models.yaml"
    content = (CONFIG_DIR / "models.yaml").read_text(encoding="utf-8")
    content = content.replace("    base_url: https://api.groq.com/openai/v1\n", "")
    path.write_text(content, encoding="utf-8")
    with pytest.raises(ConfigError, match="groq"):
        load_models_registry(path, Settings())


def test_google_genai_with_base_url_raises_config_error(tmp_path: Path) -> None:
    path = tmp_path / "models.yaml"
    path.write_text(
        (CONFIG_DIR / "models.yaml")
        .read_text(encoding="utf-8")
        .replace(
            "    client: google_genai\n",
            "    client: google_genai\n    base_url: https://example.com/v1\n",
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="gemini"):
        load_models_registry(path, Settings())


def test_unknown_client_raises_config_error(tmp_path: Path) -> None:
    path = tmp_path / "models.yaml"
    path.write_text(
        (CONFIG_DIR / "models.yaml").read_text(encoding="utf-8").replace("client: openai", "client: unknown"),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError):
        load_models_registry(path, Settings())
