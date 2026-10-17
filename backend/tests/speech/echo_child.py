"""A stand-in speech child for the runner tests: it behaves as `--mode` says and imports nothing heavy."""

import argparse
import json
import os
import sys
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["ok", "fail", "hang", "garbage"], required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.mode == "ok":
        result = {"path_set": bool(os.environ.get("PATH")), "hf_home": os.environ.get("HF_HOME"), "argv": sys.argv[1:]}
        args.out.write_text(json.dumps(result), encoding="utf-8")
        return
    if args.mode == "garbage":
        args.out.write_text("[1, 2", encoding="utf-8")
        return
    # A partial result first, as a crashing child may leave one: the runner must still remove it.
    args.out.write_text("{}", encoding="utf-8")
    print("echo child stderr marker", file=sys.stderr, flush=True)
    if args.mode == "fail":
        raise SystemExit(3)
    time.sleep(60)


if __name__ == "__main__":
    main()
