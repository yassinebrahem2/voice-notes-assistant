"""Decoding an uploaded recording to the 16 kHz mono samples the speech models read."""

from dataclasses import dataclass
from pathlib import Path

import av
import numpy as np
from av.error import FFmpegError

SAMPLE_RATE = 16_000
PEAK_COUNT = 96


class AudioUnreadable(Exception):
    """The file is not audio PyAV can decode."""


@dataclass(frozen=True)
class DecodedAudio:
    duration_ms: int
    peaks: list[float]


def _decode_samples(src: Path) -> np.ndarray:
    parts: list[np.ndarray] = []
    with av.open(str(src)) as container:
        if not container.streams.audio:
            raise AudioUnreadable("The file has no audio stream.")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(container.streams.audio[0]):
            parts.extend(out.to_ndarray().reshape(-1) for out in resampler.resample(frame))
        # The resampler holds back its last samples until it is flushed.
        parts.extend(out.to_ndarray().reshape(-1) for out in resampler.resample(None))
    return np.concatenate(parts).astype(np.float32) if parts else np.zeros(0, dtype=np.float32)


def _peaks(samples: np.ndarray) -> list[float]:
    magnitudes = np.abs(samples)
    overall = float(magnitudes.max()) if magnitudes.size else 0.0
    if overall == 0.0:
        return [0.0] * PEAK_COUNT
    return [float(bucket.max()) / overall if bucket.size else 0.0 for bucket in np.array_split(magnitudes, PEAK_COUNT)]


def decode_to_npy(src: Path, dest: Path) -> DecodedAudio:
    try:
        samples = _decode_samples(src)
    except FFmpegError as error:
        raise AudioUnreadable("The audio could not be decoded.") from error
    dest.parent.mkdir(parents=True, exist_ok=True)
    np.save(dest, samples)
    return DecodedAudio(duration_ms=round(samples.shape[0] * 1000 / SAMPLE_RATE), peaks=_peaks(samples))
