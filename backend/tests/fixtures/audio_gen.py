"""Test audio generated with PyAV at test time, so the repository holds no binary audio fixtures."""

from pathlib import Path
from typing import Literal

import av
import numpy as np


def write_tone(
    path: Path,
    *,
    codec: Literal["aac", "pcm_s16le"],
    rate: int,
    layout: str,
    seconds: float,
    amplitude: float = 0.5,
    frequency: float = 440.0,
) -> Path:
    samples = round(seconds * rate)
    wave = (amplitude * np.sin(2 * np.pi * frequency * np.arange(samples) / rate)).astype(np.float32)
    channels = 2 if layout == "stereo" else 1
    with av.open(str(path), "w") as container:
        # PyAV's stubs leave add_stream's **kwargs and Packet's stream type parameter untyped.
        stream = container.add_stream(codec, rate=rate, layout=layout)  # pyright: ignore[reportUnknownMemberType]
        frame = av.AudioFrame.from_ndarray(np.tile(wave, (channels, 1)), format="fltp", layout=layout)
        frame.sample_rate = rate
        # Encoding None flushes the frames the encoder still holds.
        packets = [*stream.encode(frame), *stream.encode(None)]  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        container.mux(packets)  # pyright: ignore[reportUnknownMemberType]
    return path


def sine_wav(path: Path, seconds: float = 2.0) -> Path:
    return write_tone(path, codec="pcm_s16le", rate=16_000, layout="mono", seconds=seconds)


def silent_wav(path: Path, seconds: float = 1.0) -> Path:
    return write_tone(path, codec="pcm_s16le", rate=16_000, layout="mono", seconds=seconds, amplitude=0.0)


def sine_m4a(path: Path, seconds: float = 2.0) -> Path:
    # 44.1 kHz stereo, like a phone recording, so decoding has to resample and downmix.
    return write_tone(path, codec="aac", rate=44_100, layout="stereo", seconds=seconds)
