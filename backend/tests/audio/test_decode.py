from pathlib import Path

import numpy as np
import pytest

from app.audio.decode import AudioUnreadable, decode_to_npy
from tests.fixtures.audio_gen import silent_wav, sine_m4a, sine_wav, write_tone


def _check_peaks(peaks: list[float]) -> None:
    assert len(peaks) == 96
    assert all(0.0 <= peak <= 1.0 for peak in peaks)


def test_decode_m4a_to_16k_mono(tmp_path: Path) -> None:
    src = sine_m4a(tmp_path / "voice.m4a")
    dest = tmp_path / "tmp" / "rec_x" / "audio.npy"

    decoded = decode_to_npy(src, dest)

    samples = np.load(dest)
    assert samples.dtype == np.float32
    assert samples.ndim == 1
    # AAC adds encoder priming and padding, so the length is only close to 2 s at 16 kHz.
    assert abs(samples.shape[0] - 32_000) < 1_600
    assert decoded.duration_ms == round(samples.shape[0] / 16)
    assert abs(decoded.duration_ms - 2_000) < 100
    _check_peaks(decoded.peaks)
    assert max(decoded.peaks) == 1.0
    # A steady tone fills every bucket, unlike silence.
    assert min(decoded.peaks[1:-1]) > 0.5


def test_decode_wav_keeps_exact_length(tmp_path: Path) -> None:
    dest = tmp_path / "audio.npy"

    decoded = decode_to_npy(sine_wav(tmp_path / "voice.wav"), dest)

    assert np.load(dest).shape == (32_000,)
    assert decoded.duration_ms == 2_000
    _check_peaks(decoded.peaks)


def test_decode_silence_peaks_zero(tmp_path: Path) -> None:
    decoded = decode_to_npy(silent_wav(tmp_path / "silence.wav"), tmp_path / "audio.npy")

    assert decoded.peaks == [0.0] * 96
    assert decoded.duration_ms == 1_000


def test_decode_fewer_samples_than_buckets_still_96_peaks(tmp_path: Path) -> None:
    src = write_tone(tmp_path / "blip.wav", codec="pcm_s16le", rate=16_000, layout="mono", seconds=50 / 16_000)

    decoded = decode_to_npy(src, tmp_path / "audio.npy")

    _check_peaks(decoded.peaks)
    assert decoded.peaks.count(0.0) >= 96 - 50
    assert max(decoded.peaks) == 1.0
    assert decoded.duration_ms == 3


def test_decode_garbage_raises_audio_unreadable(tmp_path: Path) -> None:
    src = tmp_path / "garbage.m4a"
    src.write_bytes(b"this is not audio" * 100)
    dest = tmp_path / "audio.npy"

    with pytest.raises(AudioUnreadable) as caught:
        decode_to_npy(src, dest)

    assert caught.value.__cause__ is not None
    assert not dest.exists()


def test_decode_without_audio_stream_raises_audio_unreadable(tmp_path: Path) -> None:
    src = tmp_path / "subtitles.srt"
    src.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    dest = tmp_path / "audio.npy"

    with pytest.raises(AudioUnreadable):
        decode_to_npy(src, dest)

    assert not dest.exists()
