"""Chat graph compiling orchestrator agent, citation checking, and state management."""

from collections.abc import Awaitable, Callable
from typing import Annotated, Any, TypedDict, cast

from langchain.agents.middleware import (
    AgentMiddleware,
    ModelCallLimitMiddleware,
    ModelRequest,
    ModelResponse,
    ToolCallLimitMiddleware,
)
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.graph.message import add_messages  # pyright: ignore[reportMissingTypeStubs]
from langgraph.graph.state import CompiledStateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.runtime import Runtime  # pyright: ignore[reportMissingTypeStubs]

from app.agents.chat_context import ChatContext
from app.agents.citations import FinalReply, check_citations
from app.agents.prompts import load_prompt
from app.agents.schemas import ChatReply
from app.agents.tools import find_recordings, search_transcripts, summarize
from app.container import Container
from app.llm.factory import build_agent
from app.llm.force_output import ForceOutputToolMiddleware


class DynamicPromptMiddleware(AgentMiddleware[Any, Any, Any]):
    """Appends today's date and scope from runtime context to the system prompt."""

    def _apply(self, request: ModelRequest[Any]) -> ModelRequest[Any]:
        context = getattr(request.runtime, "context", None)
        if context is None:
            return request
        today = getattr(context, "today", None)
        scope = getattr(context, "scope", None)
        parts: list[str] = []
        if today is not None:
            parts.append(f"Today's date: {today}")
        if scope is not None:
            parts.append(f"Scope: {scope}")
        if not parts:
            return request
        base = request.system_prompt or ""
        new_prompt = f"{base}\n\n" + "\n".join(parts) if base else "\n".join(parts)
        return request.override(system_message=SystemMessage(content=new_prompt))

    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any] | AIMessage:
        return handler(self._apply(request))

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any] | AIMessage:
        return await handler(self._apply(request))


class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    structured_response: ChatReply | None
    final: FinalReply | None


def check_citations_node(state: ChatState, runtime: Runtime[ChatContext]) -> dict[str, Any]:
    return {"final": check_citations(state.get("structured_response"), runtime.context.sources)}


def build_chat_graph(container: Container) -> CompiledStateGraph[Any, Any, Any, Any]:
    """Build the compiled chat graph connecting orchestrator agent to citation checking."""
    orchestrator_prompt = load_prompt("orchestrator")
    orchestrator_agent = build_agent(
        container.models,
        "llm",
        name="orchestrator",
        system_prompt=orchestrator_prompt,
        tools=[search_transcripts, find_recordings, summarize],
        schema=ChatReply,
        context_schema=ChatContext,
        extra_middleware=[
            ForceOutputToolMiddleware(from_turn=9),
            DynamicPromptMiddleware(),
            ModelCallLimitMiddleware(run_limit=10, exit_behavior="end"),
            ToolCallLimitMiddleware(run_limit=7),
        ],
    )

    builder = StateGraph(ChatState, context_schema=ChatContext)
    builder.add_node("orchestrator", orchestrator_agent)  # pyright: ignore[reportUnknownMemberType]
    builder.add_node("check_citations", check_citations_node)  # pyright: ignore[reportUnknownMemberType]
    builder.add_edge(START, "orchestrator")
    builder.add_edge("orchestrator", "check_citations")
    builder.add_edge("check_citations", END)

    return cast(
        CompiledStateGraph[Any, Any, Any, Any],
        builder.compile(),  # pyright: ignore[reportUnknownMemberType]
    )
