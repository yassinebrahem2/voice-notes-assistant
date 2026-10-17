"""Runs one speech step in a child process, so its model and GPU memory are freed when the child exits."""

import json
import logging
import subprocess
import sys
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import cast

logger = logging.getLogger(__name__)

# `-m app.speech.<step>` resolves from the working directory, so children always start in the backend folder.
BACKEND_DIR = Path(__file__).resolve().parents[2]


class ChildFailed(Exception):
    """The child exited non-zero (`returncode`) or was killed after its timeout (`returncode` is None)."""

    def __init__(self, returncode: int | None) -> None:
        self.returncode = returncode
        super().__init__("timed out" if returncode is None else f"exit code {returncode}")


class ChildOutputError(Exception):
    """The child exited cleanly but its result is not the JSON object its step expects."""


def _log_stderr(module: str, stderr: str | bytes | None, level: int) -> None:
    text = stderr.decode("utf-8", "replace") if isinstance(stderr, bytes) else stderr
    if text and text.strip():
        logger.log(level, "Speech child %s stderr:\n%s", module, text.rstrip())


def run_child(module: str, args: list[str], *, timeout_s: float, env: Mapping[str, str]) -> dict[str, object]:
    """Runs `python -m module *args --out <file>` and returns the JSON object the child wrote to that file."""
    with tempfile.TemporaryDirectory(prefix="speech-child-") as folder:
        out = Path(folder) / "result.json"
        command = [sys.executable, "-m", module, *args, "--out", str(out)]
        try:
            completed = subprocess.run(  # noqa: S603  -- this interpreter running a speech module of ours, no shell
                command,
                cwd=BACKEND_DIR,
                env=dict(env),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as expired:
            # subprocess.run has killed the child and collected what it printed before raising.
            _log_stderr(module, expired.stderr, logging.WARNING)
            logger.warning("Speech child %s killed after %.0f s", module, timeout_s)
            raise ChildFailed(None) from None
        if completed.returncode != 0:
            _log_stderr(module, completed.stderr, logging.WARNING)
            logger.warning("Speech child %s exited with code %d", module, completed.returncode)
            raise ChildFailed(completed.returncode)
        _log_stderr(module, completed.stderr, logging.INFO)
        try:
            result = cast(object, json.loads(out.read_text(encoding="utf-8")))
        except (OSError, UnicodeError, ValueError):
            raise ChildOutputError(f"Speech child {module} wrote no readable JSON result") from None
    if not isinstance(result, dict):
        raise ChildOutputError(f"Speech child {module} result is not a JSON object")
    return cast(dict[str, object], result)
