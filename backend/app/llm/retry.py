"""Retry classification for chat model providers."""

import httpx
import openai
from langchain_core.exceptions import (
    ModelAPIError,
    ModelConnectionError,
    ModelError,
    ModelRateLimitError,
    ModelTimeoutError,
)


def should_retry(error: BaseException) -> bool:
    """Return True if the error is a transient server or connection error.

    Retries on:
    - langchain_core.exceptions.ModelAPIError, ModelConnectionError, ModelTimeoutError
    - httpx.TimeoutException, httpx.TransportError (Google client raw errors)
    - openai.APIStatusError with HTTP status >= 500 (e.g. 500, 502, 503, 504)
    - openai.APITimeoutError
    - openai.APIConnectionError

    Does NOT retry on:
    - ModelRateLimitError (triggers failover to secondary provider)
    - other ModelError (400, 401, 403, 404, context overflow)
    - 429 RateLimitError (triggers failover)
    - other 4xx openai.APIStatusError
    - any other client or local exception
    """
    if isinstance(error, ModelRateLimitError):
        return False
    if isinstance(error, (ModelAPIError, ModelConnectionError, ModelTimeoutError)):
        return True
    if isinstance(error, ModelError):
        return False
    if isinstance(error, (httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(error, openai.APIStatusError):
        return error.status_code >= 500
    return isinstance(error, (openai.APITimeoutError, openai.APIConnectionError))
