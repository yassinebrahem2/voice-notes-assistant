"""Where a recording's audio and decoded audio live in the data dir, and their removal."""

import shutil
from pathlib import Path


def _check_name(part: str) -> None:
    # AGENTS.md forbids a recursive delete that could reach the data dir: "..", "." or a separator in a name would.
    if part in ("", ".", "..") or "/" in part or "\\" in part:
        raise ValueError("Not a plain file name.")


def audio_path(data_dir: Path, rec_id: str, ext: str) -> Path:
    _check_name(rec_id)
    _check_name(ext)
    return data_dir / "audio" / f"{rec_id}.{ext}"


def tmp_dir(data_dir: Path, rec_id: str) -> Path:
    _check_name(rec_id)
    return data_dir / "tmp" / rec_id


def remove_recording_files(data_dir: Path, rec_id: str, ext: str) -> None:
    audio = audio_path(data_dir, rec_id, ext)
    tmp = tmp_dir(data_dir, rec_id)
    audio.unlink(missing_ok=True)
    if tmp.is_symlink():
        # Removing the link itself keeps whatever it points at untouched.
        tmp.unlink()
    elif tmp.is_dir():
        shutil.rmtree(tmp)
