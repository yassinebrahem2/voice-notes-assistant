import argparse
import json
import os
import sys
from pathlib import Path

import uvicorn

from app.api.app import create_app
from app.config.app_config import load_app_config
from app.config.settings import load_settings
from app.container import build_container
from app.db.connection import connect
from app.db.migrate import apply_migrations

OPENAPI_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the backend or export its API contract.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("serve", help="Start the API on the configured host and port.")
    export = commands.add_parser("export-openapi", help="Export the stable API schema.")
    export.add_argument("--check", action="store_true", help="Fail if the committed schema is stale.")
    commands.add_parser("seed-demo", help="Seed demo data for mobile development.")
    args = parser.parse_args(argv)
    settings = load_settings(load_app_config())
    container = build_container(settings)
    app = create_app(container, start_worker=args.command == "serve")
    if args.command == "export-openapi":
        schema = json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        if args.check:
            if not OPENAPI_PATH.is_file() or OPENAPI_PATH.read_text(encoding="utf-8") != schema:
                print("OpenAPI schema is stale. Run: python -m app.cli export-openapi", file=sys.stderr)
                raise SystemExit(1)
        else:
            OPENAPI_PATH.write_text(schema, encoding="utf-8", newline="\n")
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
