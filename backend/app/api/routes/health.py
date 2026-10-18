from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.api.models.health import HealthOut
from app.config.settings import hf_token, provider_key
from app.container import Container
from app.llm.factory import missing_key_envs
from app.rag.fastembed_embedder import FastEmbedEmbedder
from app.speech.real import RealAsr, RealDiarizer, speech_extra_installed

router = APIRouter(tags=["health"])


def join_key_names(names: Sequence[str]) -> str:
    """Join names as `A`, `A and B` or `A, B and C`."""
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


@router.get("/health", response_model=HealthOut, operation_id="get_health")
def get_health(container: Annotated[Container, Depends(get_container)]) -> HealthOut:
    roles: dict[str, str] = dict.fromkeys(("llm", "llm_analysis", "embedder", "asr", "diarizer"), "ready")
    for role in ("llm", "llm_analysis"):
        # A role works as long as one of its models has a key: the others are skipped in its failover list.
        entries = getattr(container.models.roles, role)
        if all(provider_key(container.models, entry.provider) is None for entry in entries):
            roles[role] = f"Missing {join_key_names(missing_key_envs(container.models, entries))}"
    # Bound fakes can always process, so only real speech has model files to check (Decision #60).
    if container.speech_backend_bound == "real" and not speech_extra_installed():
        roles["asr"] = "Speech extra not installed"
        roles["diarizer"] = "Speech extra not installed"
    else:
        if isinstance(container.asr, RealAsr) and not container.asr.is_cached():
            roles["asr"] = "Model not downloaded"
        if container.speech_backend_bound == "real" and hf_token() is None:
            roles["diarizer"] = "Missing HF_TOKEN"
        elif isinstance(container.diarizer, RealDiarizer) and not container.diarizer.is_cached():
            roles["diarizer"] = "Model not downloaded"
    if isinstance(container.embedder, FastEmbedEmbedder) and not container.embedder.is_cached():
        roles["embedder"] = "Model not downloaded"
    return HealthOut(
        app_name=container.app_config.name,
        version=container.app_config.version,
        speech_backend=container.speech_backend_bound,
        roles=roles,
    )
