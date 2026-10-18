from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.errors import ErrorOut, register_error_handlers
from app.api.routes import chats, health, recordings, tags
from app.container import Container
from app.processing.worker import Worker


def create_app(container: Container, *, start_worker: bool = False) -> FastAPI:
    # Only the server runs the worker; tests and the other CLI commands build the app without one.
    worker = Worker(container) if start_worker else None
    if worker is not None:
        container.worker = worker

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        if worker is None:
            yield
            return
        worker.start()
        try:
            yield
        finally:
            worker.stop()
            container.worker = None

    app = FastAPI(
        lifespan=lifespan,
        title=container.app_config.name,
        version=container.app_config.version,
        responses={
            422: {"model": ErrorOut, "description": "Invalid request"},
            501: {"model": ErrorOut, "description": "Feature not implemented"},
            "4XX": {"model": ErrorOut, "description": "Request error"},
            "5XX": {"model": ErrorOut, "description": "Server error"},
        },
    )
    app.state.container = container
    register_error_handlers(app)
    for router in (health.router, recordings.router, tags.router, chats.router):
        app.include_router(router, prefix="/api/v1")
    return app
