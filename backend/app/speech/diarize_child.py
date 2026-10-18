"""Diarizer child: `python -m app.speech.diarize_child --audio <npy> --model <id> --device <d> --out <json>`.

torch and pyannote.audio are imported only inside `main()` and `download()`: CI installs no speech extra, and the
container and `setup` import this module without it. The token comes from `HF_TOKEN` in the environment.
"""

import argparse
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

SAMPLE_RATE = 16000


@dataclass
class ChildTurn:
    start_ms: int
    end_ms: int
    speaker: str


def download(model: str, hub_dir: Path, token: str) -> Path:
    """Downloads every file pyannote loads for `model` into the hub cache `hub_dir`; returns its snapshot folder."""
    from huggingface_hub.file_download import repo_folder_name
    from pyannote.audio import Pipeline  # pyright: ignore[reportMissingImports, reportUnknownVariableType]  -- optional speech extra not installed in CI

    # Loading the pipeline is how pyannote fetches the sub-models its config names, not only the config itself.
    if Pipeline.from_pretrained(model, token=token, cache_dir=hub_dir) is None:  # pyright: ignore[reportUnknownMemberType]  -- optional speech extra not installed in CI
        raise RuntimeError("pyannote could not download the diarizer pipeline")
    # Every file pyannote fetched for `model` sits in the snapshot that the hub cache's refs/main names.
    repo_dir = hub_dir / repo_folder_name(repo_id=model, repo_type="model")
    return repo_dir / "snapshots" / (repo_dir / "refs" / "main").read_text(encoding="utf-8").strip()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Diarize decoded audio with pyannote.audio.")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    import numpy as np
    import torch  # pyright: ignore[reportMissingImports]  -- optional speech extra not installed in CI
    from pyannote.audio import Pipeline  # pyright: ignore[reportMissingImports, reportUnknownVariableType]  -- optional speech extra not installed in CI

    pipeline = Pipeline.from_pretrained(args.model, token=os.environ.get("HF_TOKEN"))  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]  -- optional speech extra not installed in CI
    if pipeline is None:
        raise SystemExit("pyannote could not load the diarizer pipeline")
    pipeline.to(torch.device(args.device))  # pyright: ignore[reportUnknownMemberType]  -- optional speech extra not installed in CI
    # pyannote gets the decoded audio in memory as (channel, time), never a path.
    waveform = torch.from_numpy(np.load(args.audio)).unsqueeze(0)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]  -- optional speech extra not installed in CI
    output = pipeline({"waveform": waveform, "sample_rate": SAMPLE_RATE})  # pyright: ignore[reportUnknownVariableType]  -- optional speech extra not installed in CI
    result: list[ChildTurn] = []
    for turn, _track, speaker in output.speaker_diarization.itertracks(yield_label=True):  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]  -- optional speech extra not installed in CI
        result.append(
            ChildTurn(
                start_ms=round(float(turn.start) * 1000),  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]  -- optional speech extra not installed in CI
                end_ms=round(float(turn.end) * 1000),  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]  -- optional speech extra not installed in CI
                speaker=str(speaker),  # pyright: ignore[reportUnknownArgumentType]  -- optional speech extra not installed in CI
            )
        )
    args.out.write_text(json.dumps({"turns": [asdict(turn) for turn in result]}), encoding="utf-8")


if __name__ == "__main__":
    main()
