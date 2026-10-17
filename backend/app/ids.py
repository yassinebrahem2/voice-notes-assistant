"""Identifiers shared by persistence and API boundaries."""

from typing import Literal

from ulid import ULID


def new_id(prefix: Literal["rec", "seg", "spk", "chk", "tag", "cht", "msg"]) -> str:
    return f"{prefix}_{ULID()}"
