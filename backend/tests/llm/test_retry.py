from collections.abc import Callable

import httpx2 as httpx
import openai
import pytest

from app.llm.retry import should_retry

CaseFactory = Callable[[httpx.Request], BaseException]

TEST_CASES: list[tuple[CaseFactory, bool]] = [
    (
        lambda req: openai.InternalServerError(
            message="500 Internal Server Error",
            response=httpx.Response(500, request=req),
            body=None,
        ),
        True,
    ),
    (
        lambda req: openai.APIStatusError(
            message="503 Service Unavailable",
            response=httpx.Response(503, request=req),
            body=None,
        ),
        True,
    ),
    (
        lambda req: openai.APITimeoutError(request=req),
        True,
    ),
    (
        lambda req: openai.APIConnectionError(request=req),
        True,
    ),
    (
        lambda req: openai.RateLimitError(
            message="429 Rate Limit Exceeded",
            response=httpx.Response(429, request=req),
            body=None,
        ),
        False,
    ),
    (
        lambda req: openai.BadRequestError(
            message="400 Bad Request",
            response=httpx.Response(400, request=req),
            body=None,
        ),
        False,
    ),
    (
        lambda _req: ValueError("Unexpected value error"),
        False,
    ),
]


@pytest.mark.parametrize(("error_factory", "expected"), TEST_CASES)
def test_should_retry_table(error_factory: CaseFactory, expected: bool) -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    error = error_factory(request)
    assert should_retry(error) is expected
