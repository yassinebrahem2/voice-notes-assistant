"""Load the shared app identity."""

from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from app.config import CONFIG_DIR, ConfigError


class AppConfig(BaseModel):
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)


def load_app_config(path: Path = CONFIG_DIR / "app.json") -> AppConfig:
    try:
        return AppConfig.model_validate_json(path.read_text(encoding="utf-8"))
    except ValidationError as error:
        fields = ", ".join(".".join(map(str, item["loc"])) or "document" for item in error.errors())
        raise ConfigError(f"Invalid app config fields: {fields}") from None
    except (OSError, UnicodeError):
        raise ConfigError("Cannot read app config") from None
