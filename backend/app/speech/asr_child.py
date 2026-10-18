"""ASR child: `python -m app.speech.asr_child --audio <npy> --model <id> --device <d> --compute <c> --out <json>`.

faster-whisper is imported only inside `main()` and `download()`: CI installs no speech extra, and the container
and `setup` import this module without it.
"""

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class ChildSegment:
    start_ms: int
    end_ms: int
    text: str


def add_torch_dll_directory() -> None:
    """On Windows, CTranslate2 finds the CUDA libraries torch ships only once their folder is a DLL directory."""
    if sys.platform == "win32":
        os.add_dll_directory(str(Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"))


def download(model: str, hub_dir: Path) -> Path:
    """Downloads `model` through faster-whisper into the hub cache `hub_dir`; returns its snapshot folder."""
    add_torch_dll_directory()
    from faster_whisper import download_model  # pyright: ignore[reportMissingImports, reportUnknownVariableType]  -- optional speech extra not installed in CI

    return Path(str(download_model(model, cache_dir=str(hub_dir))))  # pyright: ignore[reportUnknownArgumentType]  -- optional speech extra not installed in CI


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Transcribe decoded audio with faster-whisper.")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--compute", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    add_torch_dll_directory()
    import numpy as np
    from faster_whisper import WhisperModel  # pyright: ignore[reportMissingImports, reportUnknownVariableType]  -- optional speech extra not installed in CI

    samples = np.load(args.audio)
    whisper = WhisperModel(args.model, device=args.device, compute_type=args.compute)  # pyright: ignore[reportUnknownVariableType]  -- optional speech extra not installed in CI
    segments, _info = whisper.transcribe(  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]  -- optional speech extra not installed in CI
        samples, language="en", vad_filter=True, condition_on_previous_text=False
    )
    result: list[ChildSegment] = []
    for segment in segments:  # pyright: ignore[reportUnknownVariableType]  -- optional speech extra not installed in CI
        result.append(
            ChildSegment(
                start_ms=round(float(segment.start) * 1000),  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]  -- optional speech extra not installed in CI
                end_ms=round(float(segment.end) * 1000),  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]  -- optional speech extra not installed in CI
                text=str(segment.text).strip(),  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]  -- optional speech extra not installed in CI
            )
        )
    args.out.write_text(json.dumps({"segments": [asdict(segment) for segment in result]}), encoding="utf-8")


if __name__ == "__main__":
    main()
