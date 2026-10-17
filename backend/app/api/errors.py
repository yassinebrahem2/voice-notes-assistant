import logging
import traceback
from enum import StrEnum
from typing import NoReturn

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


def describe_frames(exc: BaseException) -> str:
    # Only locations: source lines and locals can hold credentials, as can the exception message.
    frames = reversed(traceback.extract_tb(exc.__traceback__))
    return " <- ".join(f"{frame.filename}:{frame.lineno} in {frame.name}" for frame in frames)


class ErrorCode(StrEnum):
    validation_error = "validation_error"
    not_found = "not_found"
    payload_too_large = "payload_too_large"
    unsupported_media_type = "unsupported_media_type"
    recording_busy = "recording_busy"
    not_failed = "not_failed"
    not_ready = "not_ready"
    audio_unreadable = "audio_unreadable"
    transcription_failed = "transcription_failed"
    diarization_failed = "diarization_failed"
    analysis_failed = "analysis_failed"
    indexing_failed = "indexing_failed"
    ai_unavailable = "ai_unavailable"
    timed_out = "timed_out"
    not_implemented = "not_implemented"
    internal_error = "internal_error"


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str


class ErrorOut(BaseModel):
    error: ErrorBody


class ApiError(Exception):
    def __init__(self, status: int, code: ErrorCode, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


def not_implemented() -> NoReturn:
    raise ApiError(501, ErrorCode.not_implemented, "This feature is not implemented yet.")


def error_response(status: int, code: ErrorCode, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content=ErrorOut(error=ErrorBody(code=code, message=message)).model_dump())


class SafeErrorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        response_started = False

        async def track_start(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, track_start)
        except Exception as exc:
            # Starlette's outer error handler re-raises to Uvicorn, which logs the exception.
            # The route template, not the URL: ids in the URL are user data.
            route_path = getattr(scope.get("route"), "path", None) or scope["path"]
            logger.error(
                "Unhandled request error: %s %r (%s) at %s",
                scope["method"],
                route_path,
                type(exc).__name__,
                describe_frames(exc),
            )
            if response_started:
                raise RuntimeError("Response failed.") from None
            response = error_response(500, ErrorCode.internal_error, "An internal error occurred.")
            await response(scope, receive, send)


def register_error_handlers(app: FastAPI) -> None:
    app.add_middleware(SafeErrorMiddleware)

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(422, ErrorCode.validation_error, "The request is invalid.")

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = ErrorCode.not_found if exc.status_code == 404 else ErrorCode.internal_error
        message = "Resource not found." if exc.status_code == 404 else "The request could not be completed."
        return error_response(exc.status_code, code, message)
