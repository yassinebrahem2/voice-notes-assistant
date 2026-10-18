import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_db
from app.api.models.tags import TagOut
from app.recordings import read

router = APIRouter(tags=["tags"])


@router.get("/tags", response_model=list[TagOut], operation_id="list_tags")
def list_tags(conn: Annotated[sqlite3.Connection, Depends(get_db)]) -> list[TagOut]:
    return read.list_tags(conn)
