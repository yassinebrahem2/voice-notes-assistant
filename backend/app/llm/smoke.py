"""Provider smoke test: runs every check and prints the report."""

from __future__ import annotations

import sys
from typing import TextIO

import google.genai
import httpx
from langchain_core.messages import AIMessage

from app.config.models_registry import LlmEntry, ModelsRegistry
from app.container import Container
from app.llm import smoke_checks as checks


class _RedactingWriter:
    def __init__(self, target: TextIO, registry: ModelsRegistry) -> None:
        self._target = target
        self._registry = registry

    def write(self, s: str) -> int:
        return self._target.write(checks.redact_keys(s, self._registry))

    def flush(self) -> None:
        self._target.flush()


def _format_tokens(usage: dict[str, int]) -> str:
    if not usage:
        return "tokens: unavailable"
    in_tok = usage.get("input_tokens", 0)
    out_tok = usage.get("output_tokens", 0)
    total_tok = usage.get("total_tokens", in_tok + out_tok)
    return f"tokens: {in_tok} in, {out_tok} out, {total_tok} total"


def run_smoke_tests(
    container: Container,
    *,
    client: httpx.Client | None = None,
    genai_client: google.genai.Client | None = None,
    out_stream: TextIO | None = None,
) -> int:
    """Run provider model existence, tool-calling, forced turn, summarizer, and failover smoke tests.

    Returns 0 if all checks pass, 1 if any check fails. Never logs or prints secrets.
    """
    registry = container.models
    raw_out = out_stream or sys.stdout
    out = _RedactingWriter(raw_out, registry)

    all_passed = True
    total_checks = 0
    passed_checks = 0

    orchestrator_turns: dict[tuple[str, str], AIMessage] = {}

    out.write("=== Provider Models Check ===\n")
    owns_client = client is None
    http_client = client if client is not None else httpx.Client()
    try:
        for p_name, provider in registry.providers.items():
            results = checks.check_provider_models(p_name, provider, registry, http_client, genai_client=genai_client)
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

    # Collect distinct configured models across all roles (preserving order)
    distinct_entries: list[LlmEntry] = []
    seen: set[tuple[str, str]] = set()
    for role_name in ("llm", "llm_analysis"):
        for entry in getattr(registry.roles, role_name):
            key = (entry.provider, entry.model)
            if key not in seen:
                seen.add(key)
                distinct_entries.append(entry)

    out.write("\n=== Model Capabilities Check ===\n")
    for entry in distinct_entries:
        # 1. Tool call turn
        total_checks += 1
        ok_tool, desc_tool, usage_tool, first_ai_msg = checks.check_orchestrator(entry, container)
        if first_ai_msg is not None:
            orchestrator_turns[(entry.provider, entry.model)] = first_ai_msg
        tokens_tool = _format_tokens(usage_tool)
        if ok_tool:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) tool call: {desc_tool} ({tokens_tool})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) tool call: {desc_tool}\n")

        # 2. Forced final turn
        total_checks += 1
        ok_final, desc_final, usage_final = checks.check_forced_final(entry, container)
        tokens_final = _format_tokens(usage_final)
        if ok_final:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) forced final turn: {desc_final} ({tokens_final})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) forced final turn: {desc_final}\n")

        # 3. Summarizer turn
        total_checks += 1
        ok_analysis, desc_analysis, usage_analysis = checks.check_analysis(entry, registry)
        tokens_analysis = _format_tokens(usage_analysis)
        if ok_analysis:
            passed_checks += 1
            out.write(f"[PASS] {entry.provider} ({entry.model}) summarizer: {desc_analysis} ({tokens_analysis})\n")
        else:
            all_passed = False
            out.write(f"[FAIL] {entry.provider} ({entry.model}) summarizer: {desc_analysis}\n")

    out.write("\n=== Cross-Provider Failover Check ===\n")
    for entry_a in distinct_entries:
        for entry_b in distinct_entries:
            if entry_a.provider == entry_b.provider:
                continue
            total_checks += 1
            prov_a = registry.providers.get(entry_a.provider)
            prov_b = registry.providers.get(entry_b.provider)
            client_a = prov_a.client if prov_a else "unknown"
            client_b = prov_b.client if prov_b else "unknown"
            label_a = f"{entry_a.provider}/{client_a}/{entry_a.model}"
            label_b = f"{entry_b.provider}/{client_b}/{entry_b.model}"
            pair_label = f"{label_a} -> {label_b}"

            msg_a = orchestrator_turns.get((entry_a.provider, entry_a.model))
            ok_cross, desc_cross, usage_cross = checks.check_cross_provider(entry_a, entry_b, container, msg_a)
            tokens_cross = _format_tokens(usage_cross)
            if ok_cross:
                passed_checks += 1
                out.write(f"[PASS] {pair_label} history: {desc_cross} ({tokens_cross})\n")
            else:
                all_passed = False
                out.write(f"[FAIL] {pair_label} history: {desc_cross}\n")

    out.write("\n=== Smoke Test Summary ===\n")
    if all_passed:
        out.write(f"All checks passed ({passed_checks}/{total_checks}).\n")
        return 0
    else:
        out.write(f"Smoke test failed ({passed_checks}/{total_checks} checks passed).\n")
        return 1
