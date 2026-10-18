"""Middleware to force structured output from a given model turn."""

from collections.abc import Awaitable, Callable, Sequence
from typing import Any, cast

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage


def _is_human_message(msg: Any) -> bool:
    if isinstance(msg, HumanMessage):
        return True
    if isinstance(msg, dict):
        msg_dict = cast(dict[str, Any], msg)
        return msg_dict.get("type") in ("human", "user")
    return getattr(msg, "type", None) in ("human", "user")


def _is_ai_message(msg: Any) -> bool:
    if isinstance(msg, AIMessage):
        return True
    if isinstance(msg, dict):
        msg_dict = cast(dict[str, Any], msg)
        return msg_dict.get("type") in ("ai", "assistant")
    return getattr(msg, "type", None) in ("ai", "assistant")


class ForceOutputToolMiddleware(AgentMiddleware[Any, Any, Any]):
    """Forces the model to produce structured output starting at turn `from_turn`.

    Counts model turns in the current run by inspecting `request.state["messages"]`
    (number of AI messages following the last human message, never an instance counter).
    From `from_turn` on, overrides `tools=[]` on the request. With ToolStrategy,
    `create_agent` binds the structured output tool and `tool_choice="any"`, so emptying
    regular tools leaves only the schema tool.
    """

    def __init__(self, from_turn: int) -> None:
        super().__init__()
        self.from_turn = from_turn

    def _get_turn_number(self, request: ModelRequest[Any]) -> int:
        state_dict = cast(dict[str, Any], request.state)
        messages = cast(Sequence[Any], state_dict.get("messages", []))

        last_human_idx = -1
        for idx, msg in enumerate(messages):
            if _is_human_message(msg):
                last_human_idx = idx

        relevant = messages[last_human_idx + 1 :] if last_human_idx >= 0 else messages
        ai_count = sum(1 for msg in relevant if _is_ai_message(msg))
        return ai_count + 1

    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any] | AIMessage:
        if self._get_turn_number(request) >= self.from_turn:
            return handler(request.override(tools=[]))
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any] | AIMessage:
        if self._get_turn_number(request) >= self.from_turn:
            return await handler(request.override(tools=[]))
        return await handler(request)
