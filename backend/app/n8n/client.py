"""HTTP client for n8n webhooks and error translation."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, cast

import httpx
from langchain_core.exceptions import ModelError
from pydantic import SecretStr

from app.n8n.settings import N8nSettings

if TYPE_CHECKING:
    from app.config.models_registry import LlmEntry, ModelsRegistry

logger = logging.getLogger(__name__)


class N8nUnavailable(ModelError):
    """Raised when n8n is unreachable, times out, is not active, or fails with 5xx."""


class N8nBadResponse(Exception):
    """Raised when n8n returns 4xx (except 404) or an invalid payload."""


def first_gemini_entry(registry: ModelsRegistry, entries: list[LlmEntry]) -> LlmEntry | None:
    """Return the first entry whose provider uses google_genai client."""
    for entry in entries:
        provider = registry.providers.get(entry.provider)
        if provider is not None and provider.client == "google_genai":
            return entry
    return None


class N8nClient:
    """Sync and async client communicating with n8n webhooks."""

    def __init__(
        self,
        settings: N8nSettings,
        secret: SecretStr,
        *,
        transport: httpx.BaseTransport | None = None,
        async_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._secret = secret
        self._sync_client = httpx.Client(timeout=settings.n8n_timeout_s, transport=transport)
        self._async_client = httpx.AsyncClient(
            timeout=None,  # noqa: S113 - unbounded per-call timeout; chat deadline bounds the overall run
            transport=async_transport,
        )

    @property
    def sync_client(self) -> httpx.Client:
        return self._sync_client

    @property
    def async_client(self) -> httpx.AsyncClient:
        return self._async_client

    def _url(self, name: str) -> str:
        return f"{self._settings.n8n_url.rstrip('/')}/webhook/{name}"

    def _headers(self) -> dict[str, str]:
        return {"X-N8N-Secret": self._secret.get_secret_value()}

    def _handle_response(self, response: httpx.Response, name: str) -> dict[str, object]:
        if response.status_code == 404:
            logger.warning("n8n workflow '%s' not active or not found (404)", name)
            raise N8nUnavailable(f"n8n workflow '{name}' not active")
        if response.status_code >= 500:
            raise N8nUnavailable(f"n8n server error (HTTP {response.status_code})")
        if response.status_code >= 400:
            raise N8nBadResponse(f"n8n returned HTTP {response.status_code}")

        try:
            data = response.json()
        except Exception as exc:
            raise N8nBadResponse("n8n response is not valid JSON") from exc

        if not isinstance(data, dict):
            raise N8nBadResponse("n8n response body is not a JSON object")

        data_dict = cast(dict[str, object], data)
        output = data_dict.get("output")
        if isinstance(output, dict):
            return cast(dict[str, object], output)
        return data_dict

    def post(self, name: str, body: dict[str, object]) -> dict[str, object]:
        url = self._url(name)
        headers = self._headers()
        try:
            response = self._sync_client.post(url, json=body, headers=headers)
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            raise N8nUnavailable("Couldn't reach n8n") from exc
        return self._handle_response(response, name)

    async def apost(self, name: str, body: dict[str, object]) -> dict[str, object]:
        url = self._url(name)
        headers = self._headers()
        try:
            response = await self._async_client.post(url, json=body, headers=headers)
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            raise N8nUnavailable("Couldn't reach n8n") from exc
        return self._handle_response(response, name)

    def close(self) -> None:
        self._sync_client.close()

    async def aclose(self) -> None:
        await self._async_client.aclose()
