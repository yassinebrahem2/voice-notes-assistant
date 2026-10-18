from pathlib import Path

import pytest

from app.audio.storage import audio_path, remove_recording_files, tmp_dir


def test_storage_paths_follow_the_data_layout(tmp_path: Path) -> None:
    assert audio_path(tmp_path, "rec_1", "m4a") == tmp_path / "audio" / "rec_1.m4a"
    assert tmp_dir(tmp_path, "rec_1") == tmp_path / "tmp" / "rec_1"


def test_remove_recording_files_tolerates_missing_files(tmp_path: Path) -> None:
    remove_recording_files(tmp_path, "rec_1", "m4a")

    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("rec_id", "ext"),
    [("..", "m4a"), (".", "m4a"), ("", "m4a"), ("../x", "m4a"), ("a\\b", "m4a"), ("rec_1", "../m4a"), ("rec_1", "")],
)
def test_remove_recording_files_rejects_path_like_names(tmp_path: Path, rec_id: str, ext: str) -> None:
    data_dir = tmp_path / "data"
    (data_dir / "tmp" / "rec_1").mkdir(parents=True)
    (data_dir / "tmp" / "rec_1" / "audio.npy").write_bytes(b"keep")
    sentinel = tmp_path / "x.m4a"
    sentinel.write_bytes(b"keep")

    with pytest.raises(ValueError):
        remove_recording_files(data_dir, rec_id, ext)

    assert (data_dir / "tmp" / "rec_1" / "audio.npy").read_bytes() == b"keep"
    assert sentinel.read_bytes() == b"keep"


def test_remove_recording_files_does_not_follow_a_symlinked_tmp_dir(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "precious").write_bytes(b"keep")
    (tmp_path / "data" / "tmp").mkdir(parents=True)
    link = tmp_path / "data" / "tmp" / "rec_1"
    link.symlink_to(outside, target_is_directory=True)

    remove_recording_files(tmp_path / "data", "rec_1", "m4a")

    assert not link.exists()
    assert not link.is_symlink()
    assert (outside / "precious").read_bytes() == b"keep"
