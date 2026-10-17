"""LLM factory and agent construction with failover, retries, and limits."""

from collections.abc import Sequence
from typing import Any, Literal

from langchain.agents import create_agent  # pyright: ignore[reportUnknownVariableType] - langchain create_agent overload has BaseCheckpointSaver[Unknown]
from langchain.agents.middleware import (
    AgentMiddleware,
    ModelCallLimitMiddleware,
    ModelFallbackMiddleware,
    ModelRetryMiddleware,
)
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from langchain_openai import ChatOpenAI
from langgraph.graph.state import CompiledStateGraph  # pyright: ignore[reportMissingTypeStubs]
from pydantic import BaseModel

from app.config import ConfigError
from app.config.models_registry import LlmEntry, ModelsRegistry
from app.config.settings import provider_key
from app.llm.force_output import ForceOutputToolMiddleware
from app.llm.retry import should_retry


def chat_model(entry: LlmEntry, registry: ModelsRegistry) -> ChatOpenAI:
    """Build a ChatOpenAI model instance for a configured LLM entry.

    Reads base_url and key from the entry's provider using provider_key.
    Sets model, timeout, max_retries=0 (our middleware manages retries),
    and passes through any entry.reasoning options.

    Raises:
        ConfigError: If the provider is unknown or its API key is missing.
    """
    provider = registry.providers.get(entry.provider)
    if provider is None:
        raise ConfigError(f"Unknown provider '{entry.provider}' in models registry")

    key = provider_key(registry, entry.provider)
    if key is None:
        raise ConfigError(f"Missing API key environment variable {provider.key_env}")

    reasoning_kwargs: dict[str, Any] = dict(entry.reasoning)
    return ChatOpenAI(
        model=entry.model,
        base_url=str(provider.base_url),
        api_key=key,
        timeout=entry.timeout_s,
        max_retries=0,
        **reasoning_kwargs,
    )


def role_models(registry: ModelsRegistry, role: Literal["llm"]) -> list[BaseChatModel]:
    """Build chat models for each configured entry in the given role, in order.

    Tests monkeypatch this function to inject scripted or failing fake models.
    """
    entries: list[LlmEntry] = getattr(registry.roles, role)
    return [chat_model(entry, registry) for entry in entries]


def chat_middleware(
    role_models: Sequence[BaseChatModel],
    *,
    retry_initial_delay: float | None = None,
) -> list[AgentMiddleware[Any, Any, Any]]:
    """Build the standard chat middleware list for a set of role models.

    Includes:
    - ModelFallbackMiddleware across secondary models (omitted if only one model)
    - ModelRetryMiddleware with max_retries=1, should_retry, and on_failure="error"
    """
    middleware: list[AgentMiddleware[Any, Any, Any]] = []
    if len(role_models) > 1:
        middleware.append(ModelFallbackMiddleware(*role_models[1:]))

    retry_kwargs: dict[str, Any] = {
        "max_retries": 1,
        "retry_on": should_retry,
        "on_failure": "error",
    }
    if retry_initial_delay is not None:
        retry_kwargs["initial_delay"] = retry_initial_delay

    middleware.append(ModelRetryMiddleware(**retry_kwargs))
    return middleware


def build_agent(
    registry: ModelsRegistry,
    role: Literal["llm"],
    *,
    name: str,
    system_prompt: str,
    tools: Sequence[BaseTool],
    schema: type[BaseModel],
    context_schema: type[Any] | None = None,
    extra_middleware: Sequence[AgentMiddleware[Any, Any, Any]] = (),
) -> CompiledStateGraph[Any, Any, Any, Any]:
    """Build a LangGraph compiled agent using create_agent with standard middleware."""
    models = role_models(registry, role)
    middleware = [*chat_middleware(models), *extra_middleware]

    return create_agent(
        model=models[0],
        tools=tools,
        system_prompt=system_prompt,
        response_format=ToolStrategy(schema),
        context_schema=context_schema,
        name=name,
        middleware=middleware,
    )


def build_entry_agent(
    model: BaseChatModel,
    *,
    name: str,
    system_prompt: str,
    schema: type[BaseModel],
) -> CompiledStateGraph[Any, Any, Any, Any]:
    """Build a single-model agent without fallback for a provided chat model.

    Used by the Summarizer's failover walk and the smoke test. Uses ForceOutputToolMiddleware(from_turn=1)
    and ModelCallLimitMiddleware(run_limit=2, exit_behavior="end").
    """
    middleware = [
        ForceOutputToolMiddleware(from_turn=1),
        ModelCallLimitMiddleware(run_limit=2, exit_behavior="end"),
    ]
    return create_agent(
        model=model,
        tools=[],
        system_prompt=system_prompt,
        response_format=ToolStrategy(schema),
        name=name,
        middleware=middleware,
    )
