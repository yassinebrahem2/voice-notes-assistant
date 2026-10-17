from fastapi import APIRouter

from app.api.errors import not_implemented
from app.api.models.tags import TagOut

router = APIRouter(tags=["tags"])


@router.get("/tags", response_model=list[TagOut], operation_id="list_tags")
def list_tags() -> list[TagOut]:
    not_implemented()
