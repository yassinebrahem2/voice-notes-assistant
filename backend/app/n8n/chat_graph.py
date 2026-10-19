"""Chat graph for n8n mode compiling n8n_agent to citation checking."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.graph.state import CompiledStateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.runtime import Runtime  # pyright: ignore[reportMissingTypeStubs]

from app.agents.chat_context import ChatContext
from app.agents.chat_graph import ChatState, check_citations_node
from app.agents.prompts import load_prompt
from app.agents.schemas import ChatReply
from app.config import ConfigError
from app.n8n.client import first_gemini_entry
from app.n8n.runs import register, unregister

if TYPE_CHECKING:
    from app.container import Container


def build_n8n_chat_graph(container: Container) -> CompiledStateGraph[Any, Any, Any, Any]:
    """Build the compiled chat graph connecting n8n_agent to citation checking."""
    if container.n8n is None:
        raise ConfigError("n8n parts not initialized on container")
    client = container.n8n.client

    async def n8n_agent(state: ChatState, runtime: Runtime[ChatContext]) -> dict[str, Any]:
        runtime.stream_writer("Asking n8n…")
        run_id = register(runtime.context)
        try:
            base_prompt = load_prompt("orchestrator")
            today = getattr(runtime.context, "today", None)
            scope = getattr(runtime.context, "scope", None)
            parts: list[str] = []
            if today is not None:
                parts.append(f"Today's date: {today}")
            if scope is not None:
                parts.append(f"Scope: {scope}")
            system_prompt = f"{base_prompt}\n\n" + "\n".join(parts) if parts else base_prompt

            prompt_lines: list[str] = []
            for msg in state.get("messages", []):
                if isinstance(msg, HumanMessage):
                    prompt_lines.append(f"User: {msg.content}")
                elif isinstance(msg, AIMessage):
                    prompt_lines.append(f"Assistant: {msg.content}")
            prompt = "\n".join(prompt_lines)

            gemini_entry = first_gemini_entry(container.models, container.models.roles.llm)
            if gemini_entry is None:
                raise ConfigError("No google_genai provider configured for llm role")
            model = gemini_entry.model

            payload: dict[str, object] = {
                "model": model,
                "run_id": run_id,
                "system_prompt": system_prompt,
                "prompt": prompt,
            }
            res = await client.apost("chat", payload)
            reply = ChatReply.model_validate(res)
            return {"structured_response": reply}
        finally:
            unregister(run_id)

    builder = StateGraph(ChatState, context_schema=ChatContext)
    builder.add_node("n8n_agent", n8n_agent)  # pyright: ignore[reportUnknownMemberType]
    builder.add_node("check_citations", check_citations_node)  # pyright: ignore[reportUnknownMemberType]
    builder.add_edge(START, "n8n_agent")
    builder.add_edge("n8n_agent", "check_citations")
    builder.add_edge("check_citations", END)

    return cast(
        CompiledStateGraph[Any, Any, Any, Any],
        builder.compile(),  # pyright: ignore[reportUnknownMemberType]
    )
