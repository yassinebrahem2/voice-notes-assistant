import sqlite3
from collections.abc import Iterator
from typing import Annotated, cast

from fastapi import Depends, Request

from app.container import Container
from app.db.connection import connect


def get_container(request: Request) -> Container:
    return cast(Container, request.app.state.container)


def get_db(container: Annotated[Container, Depends(get_container)]) -> Iterator[sqlite3.Connection]:
    conn = connect(container.db_path, check_same_thread=False)
    try:
        yield conn
    finally:
        conn.close()
