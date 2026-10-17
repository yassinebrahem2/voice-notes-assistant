"""Provider smoke tests and validation of model capabilities and tools."""

from __future__ import annotations

import asyncio
import dataclasses
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, TextIO, cast

import httpx2 as httpx
import openai
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from app.agents.chat_context import ChatContext
from app.agents.chat_graph import build_chat_graph
from app.agents.prompts import load_prompt
from app.agents.schemas import ChatReply, NoteAnalysis
from app.agents.sources import SourceRegistry
from app.agents.transcript_input import render_transcript
from app.config.models_registry import LlmEntry, ModelsRegistry, Provider
from app.config.settings import provider_key
from app.container import Container
from app.db.connection import connect
from app.db.migrate import apply_migrations
from app.llm.factory import build_entry_agent, chat_model
from app.processing.protocols import TranscriptLine
from app.rag.fakes import FakeEmbedder

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


def _redact_keys(text: str, registry: ModelsRegistry) -> str:
    redacted = text
    for p_name in registry.providers:
        secret = provider_key(registry, p_name)
        if secret is not None:
            val = secret.get_secret_value()
            if val and val in redacted:
                redacted = redacted.replace(val, "[REDACTED]")
    return redacted


def _format_error(err: Exception, registry: ModelsRegistry | None = None) -> str:
    target: Exception = err
    if not isinstance(target, openai.APIStatusError) and isinstance(target.__cause__, openai.APIStatusError):
        target = target.__cause__

    if isinstance(target, openai.APIStatusError):
        msg = target.message or (str(target.body) if target.body is not None else str(target))
        detail = f"HTTP {target.status_code}: {msg}"
    else:
        err_str = str(target)
        detail = f"{type(target).__name__}: {err_str}" if err_str else type(target).__name__
    if registry is not None:
        detail = _redact_keys(detail, registry)
    return detail


class _RedactingWriter:
    def __init__(self, target: TextIO, registry: ModelsRegistry) -> None:
        self._target = target
        self._registry = registry

    def write(self, s: str) -> int:
        return self._target.write(_redact_keys(s, self._registry))

    def flush(self) -> None:
        self._target.flush()


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
        return [(False, f"GET /models failed ({_format_error(err, registry)})")]


def _check_llm_orchestrator(
    entry: LlmEntry,
    container: Container,
) -> tuple[bool, str, dict[str, int]]:
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_db_path = Path(tmp_dir) / "smoke.sqlite3"
            conn = connect(temp_db_path)
            try:
                apply_migrations(conn)
            finally:
                conn.close()

            roles_copy = container.models.roles.model_copy(update={"llm": [entry]})
            entry_registry = container.models.model_copy(update={"roles": roles_copy})
            temp_container = dataclasses.replace(
                container,
                models=entry_registry,
                db_path=temp_db_path,
                embedder=FakeEmbedder(),
            )
            graph = build_chat_graph(temp_container)
            ctx = ChatContext(
                db_path=temp_db_path,
                embedder=temp_container.embedder,
                settings=temp_container.settings,
                models=entry_registry,
                scope="both",
                tag_ids=[],
                today=date.today(),
                sources=SourceRegistry(),
            )
            res = cast(
                dict[str, Any],
                asyncio.run(
                    graph.ainvoke(  # pyright: ignore[reportUnknownMemberType]
                        {"messages": [HumanMessage(content="Search notes about budget")]},
                        context=ctx,
                    )
                ),
            )

        messages_raw: Any = res.get("messages", [])
        messages = cast(list[BaseMessage], messages_raw) if isinstance(messages_raw, list) else []

        usage: dict[str, int] = {}
        for msg in messages:
            if isinstance(msg, AIMessage):
                msg_usage = _extract_token_usage(msg)
                for k, v in msg_usage.items():
                    usage[k] = usage.get(k, 0) + v

        tool_call_name: str | None = None
        for msg in messages:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    tc_name = tc.get("name")
                    if tc_name and tc_name != "ChatReply" and tool_call_name is None:
                        tool_call_name = str(tc_name)

        if not tool_call_name:
            return (False, "no tool call returned", usage)

        if res.get("structured_response") is None:
            return (False, "no structured response returned", usage)

        return (True, f"called '{tool_call_name}'", usage)
    except Exception as err:
        return (False, f"tool call failed ({_format_error(err, container.models)})", {})


def _check_llm_entry(
    entry: LlmEntry,
    container: Container,
    *,
    check_type: str,
) -> tuple[bool, str, dict[str, int]]:
    if check_type == "tool_call":
        return _check_llm_orchestrator(entry, container)

    if check_type == "forced_final":
        registry = container.models
        try:
            model = chat_model(entry, registry)
        except Exception as err:
            return (False, f"model construction failed ({_format_error(err, registry)})", {})

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
            return (False, f"forced final turn failed ({_format_error(err, registry)})", {})

    return (False, f"unknown check type {check_type}", {})


def _check_analysis_entry(
    entry: LlmEntry,
    registry: ModelsRegistry,
) -> tuple[bool, str, dict[str, int]]:
    prompt = load_prompt("summarizer_note")
    user_content = f"{render_transcript(SAMPLE_TRANSCRIPT_LINES)}\n\nExisting tags: none"

    try:
        agent = build_entry_agent(
            chat_model(entry, registry),
            name="smoke_summarizer",
            system_prompt=prompt,
            schema=NoteAnalysis,
        )
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
        return (False, f"summarizer failed ({_format_error(err, registry)})", {})


def run_smoke_tests(
    container: Container,
    *,
    client: httpx.Client | None = None,
    out_stream: TextIO | None = None,
) -> int:
    """Run provider model existence, tool-calling, forced turn, and summarizer smoke tests.

    Returns 0 if all checks pass, 1 if any check fails. Never logs or prints secrets.
    """
    registry = container.models
    raw_out = out_stream or sys.stdout
    out = _RedactingWriter(raw_out, registry)

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
        ok_tool, desc_tool, usage_tool = _check_llm_entry(entry, container, check_type="tool_call")
        tokens_tool = _format_tokens(usage_tool)
        if ok_tool:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) tool call: {desc_tool} ({tokens_tool})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) tool call: {desc_tool}\n")

        # 2. Forced final turn
        total_checks += 1
        ok_final, desc_final, usage_final = _check_llm_entry(entry, container, check_type="forced_final")
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
