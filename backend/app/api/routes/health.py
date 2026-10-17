from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.api.models.health import HealthOut
from app.config.settings import hf_token, provider_key
from app.container import Container
from app.rag.fastembed_embedder import FastEmbedEmbedder
from app.speech.real import RealAsr, RealDiarizer

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut, operation_id="get_health")
def get_health(container: Annotated[Container, Depends(get_container)]) -> HealthOut:
    roles: dict[str, str] = dict.fromkeys(("llm", "llm_analysis", "embedder", "asr", "diarizer"), "ready")
    for role in ("llm", "llm_analysis"):
        first = getattr(container.models.roles, role)[0]
        if provider_key(container.models, first.provider) is None:
            roles[role] = f"Missing {container.models.providers[first.provider].key_env}"
    # Bound fakes can always process, so only real speech has model files to check (Decision #60).
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
