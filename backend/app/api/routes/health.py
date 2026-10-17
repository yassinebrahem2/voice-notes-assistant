from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.api.models.health import HealthOut
from app.config.settings import hf_token, provider_key
from app.container import Container

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut, operation_id="get_health")
def get_health(container: Annotated[Container, Depends(get_container)]) -> HealthOut:
    roles: dict[str, str] = dict.fromkeys(("llm", "llm_analysis", "embedder", "asr", "diarizer"), "ready")
    for role in ("llm", "llm_analysis"):
        first = getattr(container.models.roles, role)[0]
        if provider_key(container.models, first.provider) is None:
            roles[role] = f"Missing {container.models.providers[first.provider].key_env}"
    if container.speech_backend_bound == "real" and hf_token() is None:
        roles["diarizer"] = "Missing HF_TOKEN"
    return HealthOut(
        app_name=container.app_config.name,
        version=container.app_config.version,
        speech_backend=container.speech_backend_bound,
        roles=roles,
    )
