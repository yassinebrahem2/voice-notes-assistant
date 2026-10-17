from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import httpx2 as httpx
import openai
import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool
from pydantic import HttpUrl, SecretStr, TypeAdapter

from app.agents.prompts import load_prompt
from app.agents.schemas import ChatReply
from app.config import ConfigError
from app.config.models_registry import LlmEntry, LocalModel, ModelsRegistry, Provider, Roles
from app.llm.factory import build_agent, build_entry_agent, chat_middleware, chat_model
from app.llm.force_output import ForceOutputToolMiddleware
from tests.agents.fake_models import FailingChatModel, ScriptedChatModel


@tool
def dummy_tool(query: str) -> str:
    """A dummy test tool."""
    return f"result for {query}"


def invoke_agent(agent: Any, messages: list[HumanMessage]) -> dict[str, Any]:
    invoke_fn = cast(Callable[[dict[str, Any]], dict[str, Any]], agent.invoke)
    return invoke_fn({"messages": messages})


def make_test_registry() -> ModelsRegistry:
    url_adapter = TypeAdapter(HttpUrl)
    return ModelsRegistry(
        providers={
            "groq": Provider(
                base_url=url_adapter.validate_python("https://api.groq.com/openai/v1"),
                key_env="GROQ_API_KEY",
            ),
            "gemini": Provider(
                base_url=url_adapter.validate_python("https://generativelanguage.googleapis.com/v1beta/openai/"),
                key_env="GEMINI_API_KEY",
            ),
        },
        roles=Roles(
            llm=[
                LlmEntry(
                    provider="groq",
                    model="openai/gpt-oss-20b",
                    max_request_tokens=8192,
                    timeout_s=30.0,
                    reasoning={"reasoning_effort": "low"},
                ),
                LlmEntry(
                    provider="gemini",
                    model="gemini-flash-latest",
                    max_request_tokens=8192,
                    timeout_s=30.0,
                ),
            ],
            llm_analysis=[
                LlmEntry(
                    provider="gemini",
                    model="gemini-flash-latest",
                    max_request_tokens=32768,
                    timeout_s=60.0,
                )
            ],
            embedder=LocalModel(model="BAAI/bge-small-en-v1.5", device="cpu"),
            asr=LocalModel(model="distil-large-v3", device="cuda"),
            diarizer=LocalModel(model="pyannote/speaker-diarization-community-1", device="cuda"),
        ),
    )


def test_chat_model_reads_key_via_key_env(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    monkeypatch.setenv("GROQ_API_KEY", "sk-test-groq-key")
    entry = registry.roles.llm[0]
    model = chat_model(entry, registry)

    assert model.model_name == "openai/gpt-oss-20b"
    assert isinstance(model.openai_api_key, SecretStr)
    assert model.openai_api_key.get_secret_value() == "sk-test-groq-key"
    assert model.max_retries == 0
    assert model.request_timeout == 30.0
    assert model.reasoning_effort == "low"


def test_missing_key_config_error_names_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    entry = registry.roles.llm[0]

    with pytest.raises(ConfigError) as exc_info:
        chat_model(entry, registry)
    assert "GROQ_API_KEY" in str(exc_info.value)


def test_tool_strategy_is_pinned(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "greeting", "text": "Hello!"},
                            "id": "call_1",
                        }
                    ],
                )
            ]
        )
    )

    def mock_role_models(_reg: ModelsRegistry, _role: str) -> list[BaseChatModel]:
        return [scripted]

    monkeypatch.setattr("app.llm.factory.role_models", mock_role_models)

    agent = build_agent(
        registry,
        "llm",
        name="test_agent",
        system_prompt="You are a helpful assistant.",
        tools=[],
        schema=ChatReply,
    )
    result = invoke_agent(agent, [HumanMessage(content="Hi")])

    assert result.get("structured_response") == ChatReply(reply_type="greeting", text="Hello!")
    assert "ChatReply" in scripted.bound_tool_names


def test_fallback_answers_when_primary_429s(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    err_429 = openai.RateLimitError(
        message="429 Rate Limit",
        response=httpx.Response(429, request=req),
        body=None,
    )
    primary = FailingChatModel(error=err_429)
    secondary = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "answer", "text": "Gemini answered"},
                            "id": "call_gemini",
                        }
                    ],
                )
            ]
        )
    )

    def mock_role_models(_reg: ModelsRegistry, _role: str) -> list[BaseChatModel]:
        return [primary, secondary]

    monkeypatch.setattr("app.llm.factory.role_models", mock_role_models)

    agent = build_agent(
        registry,
        "llm",
        name="test_agent",
        system_prompt="You are a helpful assistant.",
        tools=[],
        schema=ChatReply,
    )
    result = invoke_agent(agent, [HumanMessage(content="What happened?")])

    assert result.get("structured_response") == ChatReply(reply_type="answer", text="Gemini answered")
    assert primary.call_count >= 1


def test_retry_then_fallback_on_500(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    err_500 = openai.InternalServerError(
        message="500 Internal Server Error",
        response=httpx.Response(500, request=req),
        body=None,
    )
    primary = FailingChatModel(error=err_500)
    secondary = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "answer", "text": "Fallback answer"},
                            "id": "call_fallback",
                        }
                    ],
                )
            ]
        )
    )

    def mock_role_models(_reg: ModelsRegistry, _role: str) -> list[BaseChatModel]:
        return [primary, secondary]

    monkeypatch.setattr("app.llm.factory.role_models", mock_role_models)

    def fast_chat_middleware(models: list[BaseChatModel]) -> list[Any]:
        return chat_middleware(models, retry_initial_delay=0.0)

    monkeypatch.setattr("app.llm.factory.chat_middleware", fast_chat_middleware)

    agent = build_agent(
        registry,
        "llm",
        name="test_agent",
        system_prompt="You are a helpful assistant.",
        tools=[],
        schema=ChatReply,
    )
    result = invoke_agent(agent, [HumanMessage(content="Test retry")])

    assert result.get("structured_response") == ChatReply(reply_type="answer", text="Fallback answer")
    assert primary.call_count == 2


def test_force_output_from_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()

    # Case 1: from_turn=1 (on first call, only ChatReply is bound with tool_choice="any")
    scripted_turn1 = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "answer", "text": "Immediate answer"},
                            "id": "c_turn1",
                        }
                    ],
                )
            ]
        )
    )

    def mock_role_models_1(_reg: ModelsRegistry, _role: str) -> list[BaseChatModel]:
        return [scripted_turn1]

    monkeypatch.setattr("app.llm.factory.role_models", mock_role_models_1)
    agent1 = build_agent(
        registry,
        "llm",
        name="turn1_agent",
        system_prompt="Prompt",
        tools=[dummy_tool],
        schema=ChatReply,
        extra_middleware=[ForceOutputToolMiddleware(from_turn=1)],
    )
    res1 = invoke_agent(agent1, [HumanMessage(content="Go")])
    assert res1.get("structured_response") == ChatReply(reply_type="answer", text="Immediate answer")
    assert scripted_turn1.bindings[0]["tool_names"] == ["ChatReply"]
    assert scripted_turn1.bindings[0]["tool_choice"] == "any"

    # Case 2: from_turn=3 (calls 1 and 2 keep regular tools, call 3 only has ChatReply and tool_choice="any")
    scripted_turn3 = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"name": "dummy_tool", "args": {"query": "1"}, "id": "t1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "dummy_tool", "args": {"query": "2"}, "id": "t2"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "answer", "text": "Forced on 3rd turn"},
                            "id": "c_turn3",
                        }
                    ],
                ),
            ]
        )
    )

    def mock_role_models_3(_reg: ModelsRegistry, _role: str) -> list[BaseChatModel]:
        return [scripted_turn3]

    monkeypatch.setattr("app.llm.factory.role_models", mock_role_models_3)
    agent3 = build_agent(
        registry,
        "llm",
        name="turn3_agent",
        system_prompt="Prompt",
        tools=[dummy_tool],
        schema=ChatReply,
        extra_middleware=[ForceOutputToolMiddleware(from_turn=3)],
    )
    res3 = invoke_agent(agent3, [HumanMessage(content="Go")])
    assert res3.get("structured_response") == ChatReply(reply_type="answer", text="Forced on 3rd turn")
    assert scripted_turn3.bindings[0]["tool_names"] == ["dummy_tool", "ChatReply"]
    assert scripted_turn3.bindings[1]["tool_names"] == ["dummy_tool", "ChatReply"]
    assert scripted_turn3.bindings[2]["tool_names"] == ["ChatReply"]
    assert scripted_turn3.bindings[2]["tool_choice"] == "any"


def test_force_output_counts_from_state_not_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    registry = make_test_registry()
    scripted = ScriptedChatModel(
        messages=iter(
            [
                # Run 1: call 1 tools, call 2 ChatReply
                AIMessage(
                    content="",
                    tool_calls=[{"name": "dummy_tool", "args": {"query": "run1"}, "id": "r1_t1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "answer", "text": "run1 done"},
                            "id": "r1_c2",
                        }
                    ],
                ),
                # Run 2: call 1 tools, call 2 ChatReply
                AIMessage(
                    content="",
                    tool_calls=[{"name": "dummy_tool", "args": {"query": "run2"}, "id": "r2_t1"}],
                ),
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "answer", "text": "run2 done"},
                            "id": "r2_c2",
                        }
                    ],
                ),
            ]
        )
    )

    def mock_role_models(_reg: ModelsRegistry, _role: str) -> list[BaseChatModel]:
        return [scripted]

    monkeypatch.setattr("app.llm.factory.role_models", mock_role_models)
    agent = build_agent(
        registry,
        "llm",
        name="multi_run_agent",
        system_prompt="Prompt",
        tools=[dummy_tool],
        schema=ChatReply,
        extra_middleware=[ForceOutputToolMiddleware(from_turn=2)],
    )

    # First run on agent
    res1 = invoke_agent(agent, [HumanMessage(content="first question")])
    assert res1.get("structured_response") == ChatReply(reply_type="answer", text="run1 done")
    assert scripted.bindings[0]["tool_names"] == ["dummy_tool", "ChatReply"]
    assert scripted.bindings[1]["tool_names"] == ["ChatReply"]

    # Second run on same agent instance: turn 1 should still keep regular tools!
    res2 = invoke_agent(agent, [HumanMessage(content="second question")])
    assert res2.get("structured_response") == ChatReply(reply_type="answer", text="run2 done")
    assert scripted.bindings[2]["tool_names"] == ["dummy_tool", "ChatReply"]
    assert scripted.bindings[3]["tool_names"] == ["ChatReply"]


def test_build_entry_agent() -> None:
    scripted = ScriptedChatModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ChatReply",
                            "args": {"reply_type": "greeting", "text": "From entry agent"},
                            "id": "entry_call",
                        }
                    ],
                )
            ]
        )
    )

    entry_agent = build_entry_agent(
        scripted,
        name="entry_agent",
        system_prompt="Entry prompt",
        schema=ChatReply,
    )
    result = invoke_agent(entry_agent, [HumanMessage(content="Start")])
    assert result.get("structured_response") == ChatReply(reply_type="greeting", text="From entry agent")
    assert scripted.bindings[0]["tool_names"] == ["ChatReply"]
    assert scripted.bindings[0]["tool_choice"] == "any"


def test_load_prompt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.agents.prompts as prompts_mod

    test_prompt_file = tmp_path / "test_prompt.md"
    test_prompt_file.write_text("# Test Prompt Content", encoding="utf-8")
    monkeypatch.setattr(prompts_mod, "PROMPTS_DIR", tmp_path)

    loaded = load_prompt("test_prompt")
    assert loaded == "# Test Prompt Content"

    with pytest.raises(FileNotFoundError):
        load_prompt("nonexistent_prompt")
