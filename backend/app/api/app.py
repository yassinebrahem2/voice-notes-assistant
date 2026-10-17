from fastapi import FastAPI

from app.api.errors import ErrorOut, register_error_handlers
from app.api.routes import chats, health, recordings, tags
from app.container import Container


def create_app(container: Container) -> FastAPI:
    app = FastAPI(
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
