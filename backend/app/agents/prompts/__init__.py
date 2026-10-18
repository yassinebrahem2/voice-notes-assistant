"""Prompt loading utilities."""

from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent


def load_prompt(name: str) -> str:
    """Load a markdown prompt template from the prompts directory.

    Raises:
        FileNotFoundError: If the prompt file does not exist.
    """
    prompt_file = PROMPTS_DIR / f"{name}.md"
    if not prompt_file.is_file():
        raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")
