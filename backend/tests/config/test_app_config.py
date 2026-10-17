from pathlib import Path

import pytest

from app.config import ConfigError
from app.config.app_config import load_app_config


def test_load_app_config_reads_name(tmp_path: Path) -> None:
    path = tmp_path / "app.json"
    path.write_text('{"name": "Test App", "version": "0.1.0"}', encoding="utf-8")
    assert load_app_config(path).name == "Test App"


def test_missing_name_raises_config_error(tmp_path: Path) -> None:
    path = tmp_path / "app.json"
    path.write_text("{}", encoding="utf-8")
    with pytest.raises(ConfigError, match="name"):
        load_app_config(path)


def test_missing_file_raises_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        load_app_config(tmp_path / "missing.json")
