"""Shared configuration locations and safe load errors."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONFIG_DIR = REPO_ROOT / "config"
ENV_FILE = REPO_ROOT / "backend" / ".env"


class ConfigError(Exception):
    """Configuration could not be loaded; messages never contain input values."""
