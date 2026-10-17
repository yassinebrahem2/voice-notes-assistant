import re
from collections.abc import Mapping


def display_name(label: str, name: str | None) -> str:
    return name or f"Speaker {label}"


def tokenize_speakers(text: str, label_to_id: Mapping[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        speaker_id = label_to_id.get(match.group(1))
        return "{{" + speaker_id + "}}" if speaker_id is not None else match.group(0)

    return re.sub(r"\bSpeaker ([A-Z])\b", replace, text)


def render_speakers(text: str, id_to_display: Mapping[str, str]) -> str:
    return re.sub(r"\{\{(spk_[A-Za-z0-9_]+)\}\}", lambda match: id_to_display.get(match.group(1), match.group(0)), text)
