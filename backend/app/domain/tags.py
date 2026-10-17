import re
from collections.abc import Collection


def normalize_tag(name: str) -> str:
    return re.sub(r"\s+", "-", name.strip().lower())[:24]


def match_existing_tag(name: str, existing: Collection[str]) -> str | None:
    normalized = normalize_tag(name)
    ordered = sorted(existing)
    for candidate in ordered:
        if normalize_tag(candidate) == normalized:
            return candidate
    for candidate in ordered:
        if normalize_tag(candidate).removesuffix("s") == normalized.removesuffix("s"):
            return candidate
    return None
