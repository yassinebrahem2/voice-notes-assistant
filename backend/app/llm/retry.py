"""Retry classification for OpenAI and compatible endpoints."""

import openai


def should_retry(error: BaseException) -> bool:
    """Return True if the error is a transient server or connection error.

    Retries on:
    - openai.APIStatusError with HTTP status >= 500 (e.g. 500, 502, 503, 504)
    - openai.APITimeoutError
    - openai.APIConnectionError

    Does NOT retry on:
    - 429 RateLimitError (triggers failover to secondary provider)
    - 400 BadRequestError
    - any other client or local exception
    """
    if isinstance(error, openai.APIStatusError):
        return error.status_code >= 500
    return isinstance(error, (openai.APITimeoutError, openai.APIConnectionError))
