import json
from pathlib import Path

import pytest

from app.api.app import create_app
from app.api.errors import ErrorCode
from app.cli import main
from app.config.app_config import AppConfig
from app.config.settings import Settings, load_settings
from app.container import Container


@pytest.fixture(autouse=True)
def isolated_cli_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("", encoding="utf-8")

    def test_settings(app: AppConfig) -> Settings:
        return load_settings(app, env_file=env_file)

    monkeypatch.setattr("app.cli.load_settings", test_settings)


def test_openapi_is_fresh() -> None:
    main(["export-openapi", "--check"])


def test_openapi_stale_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.cli.OPENAPI_PATH", tmp_path / "openapi.json")
    with pytest.raises(SystemExit) as caught:
        main(["export-openapi", "--check"])
    assert caught.value.code == 1
    main(["export-openapi"])
    assert json.loads((tmp_path / "openapi.json").read_text(encoding="utf-8"))["openapi"]
    main(["export-openapi", "--check"])


def test_error_codes_in_openapi(container: Container) -> None:
    schema = create_app(container).openapi()
    assert set(schema["components"]["schemas"]["ErrorCode"]["enum"]) == {code.value for code in ErrorCode}
