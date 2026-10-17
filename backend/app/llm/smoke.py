"""Provider smoke tests and validation of model capabilities and tools."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING, Any, TextIO, cast

import httpx2 as httpx
from langchain.tools import tool
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from app.agents.prompts import load_prompt
from app.agents.schemas import ChatReply, NoteAnalysis
from app.agents.transcript_input import render_transcript
from app.config.models_registry import LlmEntry, ModelsRegistry, Provider
from app.config.settings import provider_key
from app.llm.factory import build_entry_agent, chat_model
from app.processing.protocols import TranscriptLine

if TYPE_CHECKING:
    from app.container import Container


SAMPLE_TRANSCRIPT_LINES: list[TranscriptLine] = [
    TranscriptLine(
        s=1,
        speaker_label=None,
        text="Weekly architecture update: completed SQLite vector search integration.",
    ),
    TranscriptLine(
        s=2,
        speaker_label=None,
        text="Next priority is to finish the provider smoke tests and calibration script.",
    ),
]


@tool
def search_transcripts(query: str) -> str:
    """Search recorded meeting and note transcripts for keywords."""
    return "Passages found"


def _extract_token_usage(message_or_response: Any) -> dict[str, int]:
    usage: dict[str, int] = {}
    metadata: Any = getattr(message_or_response, "usage_metadata", None)
    if isinstance(metadata, dict):
        meta_dict = cast(dict[str, Any], metadata)
        for k in ("input_tokens", "output_tokens", "total_tokens"):
            val: Any = meta_dict.get(k)
            if isinstance(val, int):
                usage[k] = val
    if not usage:
        resp_meta: Any = getattr(message_or_response, "response_metadata", {})
        if isinstance(resp_meta, dict):
            resp_dict = cast(dict[str, Any], resp_meta)
            token_usage: Any = resp_dict.get("token_usage")
            if isinstance(token_usage, dict):
                tu_dict = cast(dict[str, Any], token_usage)
                for k, target in (
                    ("prompt_tokens", "input_tokens"),
                    ("completion_tokens", "output_tokens"),
                    ("total_tokens", "total_tokens"),
                ):
                    val: Any = tu_dict.get(k)
                    if isinstance(val, int):
                        usage[target] = val
    return usage


def _format_tokens(usage: dict[str, int]) -> str:
    if not usage:
        return "tokens: unavailable"
    in_tok = usage.get("input_tokens", 0)
    out_tok = usage.get("output_tokens", 0)
    total_tok = usage.get("total_tokens", in_tok + out_tok)
    return f"tokens: {in_tok} in, {out_tok} out, {total_tok} total"


def _check_provider_models(
    provider_name: str,
    provider: Provider,
    registry: ModelsRegistry,
    client: httpx.Client,
) -> list[tuple[bool, str]]:
    key = provider_key(registry, provider_name)
    if key is None:
        return [(False, f"Missing {provider.key_env}")]

    configured_models = {
        entry.model
        for role_name in ("llm", "llm_analysis")
        for entry in getattr(registry.roles, role_name)
        if entry.provider == provider_name
    }

    url = f"{str(provider.base_url).rstrip('/')}/models"
    headers = {"Authorization": f"Bearer {key.get_secret_value()}"}
    try:
        resp = client.get(url, headers=headers, timeout=15.0)
        if resp.status_code != 200:
            return [(False, f"GET /models failed with HTTP {resp.status_code}")]

        data_raw = cast(object, resp.json())
        raw_items: list[Any] = []
        if isinstance(data_raw, dict):
            raw_dict = cast(dict[str, Any], data_raw)
            raw_data = raw_dict.get("data")
            if isinstance(raw_data, list):
                raw_items = cast(list[Any], raw_data)
            else:
                raw_models = raw_dict.get("models")
                if isinstance(raw_models, list):
                    raw_items = cast(list[Any], raw_models)

        available_ids: set[str] = set()
        for item in raw_items:
            if isinstance(item, dict):
                item_dict = cast(dict[str, Any], item)
                raw_mid = item_dict.get("id") or item_dict.get("name")
                if isinstance(raw_mid, str):
                    mid: str = raw_mid
                    available_ids.add(mid)
                    if mid.startswith("models/"):
                        available_ids.add(mid.removeprefix("models/"))

        results: list[tuple[bool, str]] = []
        for model in sorted(configured_models):
            if model in available_ids:
                results.append((True, f"model '{model}' exists"))
            else:
                results.append((False, f"model '{model}' not found in provider models"))
        return results
    except Exception as err:
        return [(False, f"GET /models failed ({type(err).__name__})")]


def _check_llm_entry(
    entry: LlmEntry,
    registry: ModelsRegistry,
    *,
    check_type: str,
) -> tuple[bool, str, dict[str, int]]:
    try:
        model = chat_model(entry, registry)
    except Exception as err:
        return (False, f"model construction failed ({type(err).__name__})", {})

    if check_type == "tool_call":
        try:
            bound: Any = model.bind_tools([search_transcripts])  # pyright: ignore[reportUnknownMemberType]
            res: Any = bound.invoke([HumanMessage(content="Search the recordings for project launch updates.")])
            usage = _extract_token_usage(res)
            tool_calls: Any = getattr(res, "tool_calls", [])
            if tool_calls and isinstance(tool_calls, list):
                tool_calls_list = cast(list[object], tool_calls)
                raw_call = tool_calls_list[0]
                if isinstance(raw_call, dict):
                    call_dict = cast(dict[str, Any], raw_call)
                    call_name = str(call_dict.get("name", ""))
                    return (True, f"called '{call_name}'", usage)
            return (False, "no tool call returned", usage)
        except Exception as err:
            return (False, f"tool call failed ({type(err).__name__})", {})

    if check_type == "forced_final":
        try:
            bound: Any = model.bind_tools([ChatReply], tool_choice="required")  # pyright: ignore[reportUnknownMemberType]
            messages: list[BaseMessage] = [
                HumanMessage(content="What did Sarah say about the launch date?"),
                AIMessage(
                    content="",
                    tool_calls=[{"name": "search_transcripts", "args": {"query": "Sarah launch date"}, "id": "call_1"}],
                ),
                ToolMessage(
                    content="<sources>[P1] Sarah (Speaker A): The launch is set for next Tuesday.</sources>",
                    tool_call_id="call_1",
                ),
            ]
            res: Any = bound.invoke(messages)
            usage = _extract_token_usage(res)
            tool_calls: Any = getattr(res, "tool_calls", [])
            if tool_calls and isinstance(tool_calls, list):
                tool_calls_list = cast(list[object], tool_calls)
                raw_call = tool_calls_list[0]
                if isinstance(raw_call, dict):
                    call_dict = cast(dict[str, Any], raw_call)
                    call_name = str(call_dict.get("name", ""))
                    if call_name == "ChatReply":
                        return (True, f"called '{call_name}'", usage)
                    return (False, f"unexpected tool call '{call_name}'", usage)
            return (False, "no tool call returned for forced final turn", usage)
        except Exception as err:
            return (False, f"forced final turn failed ({type(err).__name__})", {})

    return (False, f"unknown check type {check_type}", {})


def _check_analysis_entry(
    entry: LlmEntry,
    registry: ModelsRegistry,
) -> tuple[bool, str, dict[str, int]]:
    prompt = load_prompt("summarizer_note")
    user_content = f"{render_transcript(SAMPLE_TRANSCRIPT_LINES)}\n\nExisting tags: none"

    try:
        agent = build_entry_agent(entry, registry, name="summarizer_note", system_prompt=prompt, schema=NoteAnalysis)
        raw_output = cast(
            dict[str, Any],
            agent.invoke({"messages": [HumanMessage(content=user_content)]}),  # pyright: ignore[reportUnknownMemberType]
        )
        output: dict[str, Any] = dict(raw_output)

        usage: dict[str, int] = {}
        messages_raw: Any = output.get("messages", [])
        if isinstance(messages_raw, list):
            messages = cast(list[object], messages_raw)
            for msg in reversed(messages):
                if isinstance(msg, AIMessage):
                    usage = _extract_token_usage(msg)
                    if usage:
                        break

        response = output.get("structured_response")
        if isinstance(response, NoteAnalysis):
            return (True, f"produced NoteAnalysis '{response.title}'", usage)
        return (False, "failed to produce NoteAnalysis", usage)
    except Exception as err:
        return (False, f"summarizer failed ({type(err).__name__})", {})


def run_smoke_tests(
    registry_or_container: ModelsRegistry | Container,
    *,
    client: httpx.Client | None = None,
    out_stream: TextIO | None = None,
) -> int:
    """Run provider model existence, tool-calling, forced turn, and summarizer smoke tests.

    Returns 0 if all checks pass, 1 if any check fails. Never logs or prints secrets.
    """
    out = out_stream or sys.stdout
    if isinstance(registry_or_container, ModelsRegistry):
        registry = registry_or_container
    else:
        registry = registry_or_container.models

    all_passed = True
    total_checks = 0
    passed_checks = 0

    out.write("=== Provider Models Check ===\n")
    owns_client = client is None
    http_client = client if client is not None else httpx.Client()
    try:
        for p_name, provider in registry.providers.items():
            results = _check_provider_models(p_name, provider, registry, http_client)
            for success, detail in results:
                total_checks += 1
                if success:
                    passed_checks += 1
                    out.write(f"[PASS] {p_name}: {detail}\n")
                else:
                    all_passed = False
                    out.write(f"[FAIL] {p_name}: {detail}\n")
    finally:
        if owns_client:
            http_client.close()

    out.write("\n=== Role 'llm' Check ===\n")
    for entry in registry.roles.llm:
        # 1. Tool call turn
        total_checks += 1
        ok_tool, desc_tool, usage_tool = _check_llm_entry(entry, registry, check_type="tool_call")
        tokens_tool = _format_tokens(usage_tool)
        if ok_tool:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) tool call: {desc_tool} ({tokens_tool})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) tool call: {desc_tool}\n")

        # 2. Forced final turn
        total_checks += 1
        ok_final, desc_final, usage_final = _check_llm_entry(entry, registry, check_type="forced_final")
        tokens_final = _format_tokens(usage_final)
        if ok_final:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) forced final turn: {desc_final} ({tokens_final})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) forced final turn: {desc_final}\n")

    out.write("\n=== Role 'llm_analysis' Check ===\n")
    for entry in registry.roles.llm_analysis:
        total_checks += 1
        ok_analysis, desc_analysis, usage_analysis = _check_analysis_entry(entry, registry)
        tokens_analysis = _format_tokens(usage_analysis)
        if ok_analysis:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) summarizer: {desc_analysis} ({tokens_analysis})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) summarizer: {desc_analysis}\n")

    out.write("\n=== Smoke Test Summary ===\n")
    if all_passed:
        out.write(f"All checks passed ({passed_checks}/{total_checks}).\n")
        return 0
    else:
        out.write(f"Smoke test failed ({passed_checks}/{total_checks} checks passed).\n")
        return 1
