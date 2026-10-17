"""Fake chat models for agent and LLM tests."""

from collections.abc import Sequence
from typing import Any, Self, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatResult
from pydantic import ConfigDict, Field


def _extract_tool_name(tool: Any) -> str:
    if hasattr(tool, "name"):
        return str(tool.name)
    try:
        return str(tool["name"])  # pyright: ignore[reportUnknownArgumentType,reportUnknownIndexType]
    except (KeyError, TypeError):
        pass
    try:
        return str(tool["function"]["name"])  # pyright: ignore[reportUnknownArgumentType,reportUnknownIndexType]
    except (KeyError, TypeError):
        pass
    return str(tool)


class ScriptedChatModel(GenericFakeChatModel):
    """GenericFakeChatModel implementing bind_tools for test assertions."""

    bound_tools: list[Any] = Field(default_factory=list)
    bound_tool_names: list[str] = Field(default_factory=list)
    bound_tool_choice: Any = None
    bindings: list[dict[str, Any]] = Field(default_factory=lambda: cast(list[dict[str, Any]], []))

    def bind_tools(
        self,
        tools: Sequence[Any],
        *,
        tool_choice: Any = None,
        **kwargs: Any,
    ) -> Self:
        self.bound_tools = list(tools)
        self.bound_tool_names = [_extract_tool_name(t) for t in tools]
        self.bound_tool_choice = tool_choice
        self.bindings.append(
            {
                "tools": list(tools),
                "tool_names": list(self.bound_tool_names),
                "tool_choice": tool_choice,
                "kwargs": kwargs,
            }
        )
        return self


class FailingChatModel(BaseChatModel):
    """Chat model that always raises a specified error on invocation."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    error: BaseException
    call_count: int = 0
    bound_tools: list[Any] = Field(default_factory=list)
    bound_tool_names: list[str] = Field(default_factory=list)
    bound_tool_choice: Any = None

    def __init__(self, error: BaseException, **kwargs: Any) -> None:
        init_kwargs: dict[str, Any] = {"error": error, **kwargs}
        super().__init__(**init_kwargs)

    def bind_tools(
        self,
        tools: Sequence[Any],
        *,
        tool_choice: Any = None,
        **kwargs: Any,
    ) -> Self:
        self.bound_tools = list(tools)
        self.bound_tool_names = [_extract_tool_name(t) for t in tools]
        self.bound_tool_choice = tool_choice
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.call_count += 1
        raise self.error

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.call_count += 1
        raise self.error

    @property
    def _llm_type(self) -> str:
        return "failing-chat-model"
