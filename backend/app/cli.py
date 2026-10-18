import argparse
import json
import os
import sys
from pathlib import Path

import uvicorn
from fastembed import TextEmbedding

from app.api.app import create_app
from app.api.routes.health import get_health
from app.config.app_config import load_app_config
from app.config.settings import hf_token, load_settings
from app.container import Container, build_container
from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.speech import asr_child, diarize_child
from app.speech.real import hf_home, record_download, speech_extra_installed

OPENAPI_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


def _missing_env_names(container: Container) -> list[str]:
    providers = container.models.providers.values()
    names = [provider.key_env for provider in providers if not os.environ.get(provider.key_env)]
    return [*names, *(["HF_TOKEN"] if hf_token() is None else [])]


def run_setup(container: Container) -> None:
    """Creates the runtime folders and downloads every model into the model cache; prints names, never values."""
    settings = container.settings
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
    roles = container.models.roles
    print(f"Downloading the embedder model into {settings.model_cache_dir}")
    # fastembed's own download, so every file it loads offline is fetched, not only the weights.
    TextEmbedding(model_name=roles.embedder.model, cache_dir=str(settings.model_cache_dir))
    hub_dir = hf_home(settings.model_cache_dir) / "hub"
    if not speech_extra_installed():
        print("The speech extra is not installed: skipping the ASR and diarizer models (uv sync --extra speech).")
    else:
        print("Downloading the ASR model")
        snapshot = asr_child.download(roles.asr.model, hub_dir)
        record_download(settings.model_cache_dir, "asr", roles.asr.model, snapshot)
        token = hf_token()
        if token is None:
            print("HF_TOKEN is not set: skipping the diarizer model.")
        else:
            print("Downloading the diarizer model")
            os.environ["PYANNOTE_METRICS_ENABLED"] = "false"
            snapshot = diarize_child.download(roles.diarizer.model, hub_dir, token.get_secret_value())
            record_download(settings.model_cache_dir, "diarizer", roles.diarizer.model, snapshot)
    health = get_health(container)
    print(f"Speech backend: {health.speech_backend}")
    for role, status in health.roles.items():
        print(f"{role}: {status}")
    missing = _missing_env_names(container)
    print(f"Missing environment variables: {', '.join(missing) if missing else 'none'}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the backend or export its API contract.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("serve", help="Start the API on the configured host and port.")
    export = commands.add_parser("export-openapi", help="Export the stable API schema.")
    export.add_argument("--check", action="store_true", help="Fail if the committed schema is stale.")
    commands.add_parser("seed-demo", help="Seed demo data for mobile development.")
    commands.add_parser("setup", help="Create the data folders, download every model and check the environment.")
    commands.add_parser("smoke-llm", help="Run provider model and LLM smoke tests.")
    calibrate = commands.add_parser(
        "calibrate-retrieval", help="Calibrate retrieval distance threshold against questions."
    )
    calibrate.add_argument("--questions", required=True, type=Path, help="Path to YAML calibration questions file.")
    args = parser.parse_args(argv)
    settings = load_settings(load_app_config())
    container = build_container(settings)
    app = create_app(container, start_worker=args.command == "serve")
    if args.command == "smoke-llm":
        from app.llm.smoke import run_smoke_tests

        exit_code = run_smoke_tests(container)
        if exit_code != 0:
            raise SystemExit(exit_code)
        return
    if args.command == "calibrate-retrieval":
        from app.rag.calibrate import run_calibration

        exit_code = run_calibration(container, args.questions)
        if exit_code != 0:
            raise SystemExit(exit_code)
        return
    if args.command == "export-openapi":
        schema = json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        if args.check:
            if not OPENAPI_PATH.is_file() or OPENAPI_PATH.read_text(encoding="utf-8") != schema:
                print("OpenAPI schema is stale. Run: python -m app.cli export-openapi", file=sys.stderr)
                raise SystemExit(1)
        else:
            OPENAPI_PATH.write_text(schema, encoding="utf-8", newline="\n")
        return
    if args.command == "setup":
        run_setup(container)
        return
    if args.command == "seed-demo":
        from app.demo_seed import DemoSeedError, seed_demo

        try:
            seed_demo(container)
        except DemoSeedError as err:
            print(f"Error: {err}", file=sys.stderr)
            raise SystemExit(1) from err
        return
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    connection = connect(container.db_path)
    try:
        apply_migrations(connection)
    finally:
        connection.close()
    os.environ["HF_HUB_OFFLINE"] = "1"
    uvicorn.run(app, host=settings.bind_host, port=settings.port)


if __name__ == "__main__":
    main()
