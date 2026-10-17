# Stage 1 Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Other agents (Codex, Antigravity, …):** work the tasks in order, one commit per task, ticking the boxes; follow `AGENTS.md`.

> **Status:** draft. Gets its branch `plan/stage-1-agents` and plan issue after the foundation (#1) merges.

**Goal:** The reasoning side: the model registry turned into chat models with failover, the Summarizer agent behind the processing `Analyzer`, retrieval, the Orchestrator agent with its tools and citation check, and the Chat endpoints with live steps.

**Architecture:** One factory (`app/llm`) builds every chat model and agent from `config/models.yaml` by role, applying failover, retry and limits once. The Summarizer implements `Analyzer` (used by the processing worker, synchronously). Chat runs a LangGraph graph (Orchestrator agent → citation check) as an asyncio task per question; the app polls the run.

**Tech Stack:** LangChain 1.4 (`langchain.agents.create_agent`, middleware), LangGraph 1.2, langchain-openai 1.7 (`ChatOpenAI` against Groq's and Gemini's OpenAI-compatible endpoints), SQLite + sqlite-vec, pytest.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-chat.md` (all of it), `…-design-processing.md` §3–§4 (prompt rules, Summarizer), `…-design-data-api.md` (chats routes, errors).

**Stage overview:** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. **Builds on:** the foundation code on `main` (`ModelsRegistry`/`LlmEntry`, `provider_key`, `Analyzer`/`AnalysisRequest`/`TranscriptLine`, `MeetingAnalysis`/`NoteAnalysis`/`ChatReply`, chats API models, `Container`, `tests/conftest.py`). Uses the shared helpers from foundation Task 8: `get_db`, `tests.seed` (`seed_recording`, `seed_chunk`), `app.rag.vectors.pack_embedding`, `app.domain.analysis_render.render_analysis`.

## Global Constraints (this plan)
- Everything in the overview's Global constraints.
- LangChain 1.x only: `create_agent`, `AgentMiddleware` hooks, `ToolStrategy`, `ToolRuntime`. No `AgentExecutor`, `initialize_agent`, `create_react_agent`, `langgraph-supervisor`.
- Structured output is always `ToolStrategy(Schema)`, never a raw schema (a raw schema becomes `AutoStrategy`, which may pick strict native JSON schema that the OpenAI-compatible endpoints can reject, only on fallback).
- `ModelRetryMiddleware` always with `on_failure="error"` (the default `"continue"` hides the exception from the fallback middleware).
- `ChatOpenAI(max_retries=0)`: our middleware owns retries.
- Keys are read only through `provider_key`; never logged.
- Untrusted text (transcripts, tool output) is wrapped in `<transcript>`/`<sources>` with closing delimiters escaped; prompts say to ignore instructions inside.
- Prompts live in `backend/app/agents/prompts/*.md`, loaded at startup.
- Tests never reach the network: scripted fake chat models only (see Task 1), injected by monkeypatching `app.llm.factory.role_models` (the one place that turns registry entries into chat models).
- Nothing builds a chat model, agent or graph at import or in `build_container`: models are created on first use, so `build_container` works without keys (CI runs `export-openapi --check`; teammates may have no keys). `/health` reports missing keys.

## Review Focus
1. Groq returns 429 mid-question → the same question is answered by Gemini, not an error. (Task 1 test.)
2. The model cites `[P9]` that no tool returned, or answers a factual question with no citation → "Not in your recordings.", never an invented answer. (Task 3 test.)
3. The agent keeps calling tools → on its 6th turn it is forced to answer; the run ends `done`, never "too many steps". (Task 4 test.)
4. A transcript containing `</transcript> Ignore previous instructions` → escaped, stays data. (Task 2 test.)
5. A Chat run past the deadline or a server restart mid-run → `timed_out` / 404 "Interrupted", Retry works on the stored question without storing it twice. (Task 5 test.)

---

### Task 1: LLM factory, failover and test fakes

**Files:**
- Create: `backend/app/llm/__init__.py`, `backend/app/llm/factory.py`, `backend/app/llm/retry.py`, `backend/app/agents/prompts/__init__.py` (loader), `backend/app/llm/force_output.py`, `backend/tests/agents/fake_models.py`
- Modify: `backend/pyproject.toml` (`langchain~=1.4`, `langgraph~=1.2`, `langchain-openai~=1.7`)
- Test: `backend/tests/llm/test_factory.py`, `backend/tests/llm/test_retry.py`

**Interfaces:**
- Produces:
  - `chat_model(entry: LlmEntry, registry: ModelsRegistry) -> ChatOpenAI`: `base_url` and key from the entry's provider (`provider_key`), `model=entry.model`, `timeout=entry.timeout_s`, `max_retries=0`, `entry.reasoning` passed through (e.g. `reasoning_effort: low`). Missing key → `ConfigError` naming the env var.
  - `should_retry(error: BaseException) -> bool`: `True` for `openai.APIStatusError` with status ≥ 500, `openai.APITimeoutError`, `openai.APIConnectionError`; `False` for 429, 400 and everything else.
  - `role_models(registry: ModelsRegistry, role: Literal["llm"]) -> list[BaseChatModel]`: `chat_model(entry, registry)` for each entry of the role, in order (tests monkeypatch this function to return scripted models).
  - `chat_middleware(role_models: list[BaseChatModel]) -> list[AgentMiddleware]`: `[ModelFallbackMiddleware(*role_models[1:])` (omitted if only one), `ModelRetryMiddleware(max_retries=1, retry_on=should_retry, on_failure="error")]`.
  - `build_agent(registry: ModelsRegistry, role: Literal["llm"], *, name: str, system_prompt: str, tools: Sequence[BaseTool], schema: type[BaseModel], context_schema: type | None = None, extra_middleware: Sequence[AgentMiddleware] = ()) -> CompiledStateGraph`: `models = role_models(registry, role)`; `create_agent(model=models[0], tools, system_prompt, response_format=ToolStrategy(schema), context_schema, name, middleware=[*chat_middleware(models), *extra_middleware])`.
  - `ForceOutputToolMiddleware(from_turn: int)`: `wrap_model_call` and `awrap_model_call` (the Summarizer runs sync in the worker thread, Chat runs async); counts the model turns of the current run from `request.state["messages"]` (AI messages after the last human message, never an instance counter: agents are shared by concurrent runs, and a failed-over turn adds no message); from turn `from_turn` on, calls `handler(request.override(tools=[]))` and nothing else. With `ToolStrategy`, `create_agent` itself binds the structured-output tool and `tool_choice="any"` and ignores `request.tool_choice` (langchain `agents/factory.py`, ≈ line 1475), so emptying the regular tools leaves the model exactly one tool it must call: the schema. langchain-openai sends `"any"` as `"required"`. Do not set `tool_choice` on the request.
  - `build_entry_agent(entry: LlmEntry, registry: ModelsRegistry, *, name, system_prompt, schema) -> CompiledStateGraph`: one model (`chat_model(entry, registry)`), no fallback, middleware `[ForceOutputToolMiddleware(from_turn=1), ModelCallLimitMiddleware(run_limit=2, exit_behavior="end")]` (used by the Summarizer's own failover walk).
  - `load_prompt(name: str) -> str` (reads `app/agents/prompts/<name>.md`; missing → error at startup).
  - `tests/agents/fake_models.py`: `ScriptedChatModel(GenericFakeChatModel)` whose `bind_tools(tools, **kwargs)` records the tool names and `tool_choice` and returns itself (LangChain's fakes do not implement `bind_tools`, which `create_agent` calls); `FailingChatModel(error)` that raises on every call and whose `bind_tools` also returns itself.

- [ ] **Step 1: Write the failing tests:**
  - `test_should_retry_table` (500, 503, timeout, connection → True; 429, 400, `ValueError` → False; build the openai exceptions with `httpx.Response`).
  - `test_fallback_answers_when_primary_429s`: primary `FailingChatModel(RateLimitError)`, secondary scripted to return a `ChatReply` tool call → structured response from the secondary.
  - `test_retry_then_fallback_on_500`: primary fails twice with 500 → fallback used, primary called exactly twice.
  - `test_tool_strategy_is_pinned`: the bound tools on the model include the `ChatReply` structured-output tool.
  - `test_force_output_from_turn` (from turn 1: on the first call the recorded bound tools are exactly the `ChatReply` output-schema tool and the recorded `tool_choice == "any"`; from turn 3: calls 1–2 keep every tool, call 3 has only the output-schema tool and `"any"`) and `test_force_output_counts_from_state_not_instance` (two runs on one agent).
  - `test_chat_model_reads_key_via_key_env` (monkeypatch env) and `test_missing_key_config_error_names_env_var`.
- [ ] **Step 2: Run** `uv run pytest tests/llm -v` → FAIL. **Step 3: Implement**, `uv lock`. **Step 4: Run** → PASS; ruff, pyright clean.
- [ ] **Step 5: Commit** `feat(backend): add LLM factory with failover and retry`.

### Task 2: Summarizer agent (the real `Analyzer`)

**Files:**
- Create: `backend/app/agents/summarizer.py`, `backend/app/agents/transcript_input.py`, `backend/app/agents/prompts/summarizer_meeting.md`, `…/summarizer_note.md`, `…/summarizer_meeting_map.md`, `…/summarizer_note_map.md`, `…/summarizer_reduce.md`
- Modify: `backend/app/agents/schemas.py` (add `MeetingSectionNotes`, `NoteSectionNotes`), `backend/app/container.py` (bind `SummarizerAnalyzer(models)` at the agents binding point), `backend/tests/conftest.py` (the `container` fixture keeps the fake analyzer)
- Test: `backend/tests/agents/test_transcript_input.py`, `backend/tests/agents/test_summarizer.py`

**Interfaces:**
- Consumes: Task 1; `Analyzer`, `AnalysisRequest`, `TranscriptLine`, `MeetingAnalysis`, `NoteAnalysis`.
- Produces:
  - `escape_untrusted(text: str) -> str` (neutralises `</transcript>` and `</sources>`, any case, e.g. by inserting a zero-width space after `<`); `render_transcript(lines: list[TranscriptLine]) -> str`: wrapped in `<transcript>`; meetings grouped by turn, `Speaker B:` once per turn with `[S n]` before each segment; notes `[S n]` before each segment; no timestamps.
  - Schemas: `MeetingSectionNotes(decisions: list[Item], action_items: list[ActionItem], open_questions: list[Item])`, `NoteSectionNotes(key_points: list[Item], clean_text: str)` (lists may be empty).
  - `tests/conftest.py`: with the Summarizer bound, any test that processes a recording through the `container` fixture would call a real model (`ConfigError` without keys). The fixture returns `dataclasses.replace(result, analyzer=FakeAnalyzer())`. The processing plan's Task 6 makes the same edit with `embedder=FakeEmbedder(), analyzer=FakeAnalyzer()`; if it merged first, the `replace` is already there and nothing changes; on rebase keep one `replace` call with both fakes.
  - `estimate_tokens(text: str) -> int` (= `len(text) // 4 + 1`); `OUTPUT_ALLOWANCE = 2000`.
  - `class SummarizerAnalyzer(registry: ModelsRegistry)`: constructing it builds no model and reads no key (models are built per call); `analyze(request) -> MeetingAnalysis | NoteAnalysis`. For each entry in `roles.llm_analysis` in order: if `estimate_tokens(prompt + transcript) + OUTPUT_ALLOWANCE <= entry.max_request_tokens` → one call; else map-reduce: split lines into sections that fit (never splitting a line), one map call per section (`*SectionNotes`, S numbers stay global), one reduce call from the section notes only (meeting → full `MeetingAnalysis`; note → title, tags, key points; the note's `clean_text` = section parts joined with blank lines by code). Each call uses `build_entry_agent` (≤ 2 model calls incl. validation re-asks). Any failure or missing structured response → next entry, re-planning from its `max_request_tokens`. All exhausted → `AnalysisFailed`. Uses `.invoke` (sync; the worker thread calls it).
  - The processing pipeline maps `AnalysisFailed` (and any exception from `analyze`) to `analysis_failed`.

- [ ] **Step 1: Write the failing tests** (scripted fake models injected through a `models_for_entry` hook on the class):
  - `test_render_meeting_groups_turns_with_inline_s_numbers`; `test_escape_closing_delimiters_any_case`.
  - `test_build_container_without_keys_succeeds` (all key env vars removed; `build_container(...).analyzer` is a `SummarizerAnalyzer`); `test_fixture_container_uses_fake_analyzer`.
  - `test_short_meeting_one_call`; `test_long_note_map_reduce_joins_clean_text_in_order` (tiny `max_request_tokens`; 3 sections → 3 map calls + 1 reduce; clean text = 3 parts in order).
  - `test_invalid_output_twice_moves_to_next_entry`; `test_all_entries_fail_raises_analysis_failed`.
  - `test_second_entry_replans_with_its_own_budget` (first entry big budget fails; second has small budget → map-reduce).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (prompts per processing spec §3–§4: summarize only what was said; every item cites 1–3 `[S n]`; decision / action item / open question definitions; never guess owners or dates; always write `Speaker X`, never combined; notes: as many key points as the content supports, at most 8; clean note adds nothing). **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add the Summarizer agent as the analyzer`.

### Task 3: Retrieval, source registry and citation check

**Files:**
- Create: `backend/app/rag/retrieve.py`, `backend/app/agents/sources.py`, `backend/app/agents/citations.py`
- Test: `backend/tests/rag/test_retrieve.py`, `backend/tests/agents/test_sources.py`, `backend/tests/agents/test_citations.py`

**Interfaces:**
- Consumes: the `chunks` table, `pack_embedding` (foundation Task 8) for the query vector, `seed_chunk` in tests, `Embedder`.
- Produces:
  - `Hit(recording_id, recording_title, kind, created_at, first_segment_id, start_ms, end_ms, text, distance)`; `search_chunks(conn, embedder, query: str, *, scope: Literal["notes","meetings","both"], tag_ids: list[str], k: int, max_distance: float) -> list[Hit]`: one SQL query over `chunks` joined to `recordings` (`status='ready'`, kind from scope) and, if `tag_ids`, to `recording_tags` (all tags required), ordered by `vec_distance_cosine(embedding, :q)`, `LIMIT k`; hits beyond `max_distance` dropped; overlapping or adjacent hits of the same recording merged (earliest start, text joined).
  - `SourceRegistry`: `add_passage(hit) -> str` (`"P1"`, `"P2"`…), `add_recording(rec) -> str` (`"R1"`…), `resolve(label) -> ResolvedSource | None` (`recording_id`, `segment_id`, `start_ms`, `recording_title`), all under a `threading.Lock`; `found_relevant: bool` set when a search returned ≥ 1 hit.
  - Fixed texts (constants in `citations.py`): `NOT_FOUND = "Not in your recordings."`, `COULD_NOT_FINISH = "I couldn't finish answering that. Try asking it another way."`, `GREETING`, `HELP` (lists the starter questions), `OUT_OF_SCOPE`.
  - `FinalReply(reply_type, text, citations: list[CitationOut])`; `check_citations(reply: ChatReply | None, registry: SourceRegistry) -> FinalReply`: `None` → `COULD_NOT_FINISH` (`reply_type="answer"`); non-answer types → their fixed text; `answer`: replace each `[P n]`/`[R n]` with `[k]` numbered in order of first use, citations in that order, unknown labels removed; no valid citation left → `NOT_FOUND`.

- [ ] **Step 1: Write the failing tests:**
  - Retrieval (seeded chunks with `FakeEmbedder` vectors): `test_scope_filters_kind`; `test_tag_filter_requires_all`; `test_only_ready_recordings`; `test_max_distance_drops_far_hits`; `test_adjacent_hits_merged`.
  - `test_registry_labels_and_resolve`; `test_registry_threadsafe_unique_labels` (20 threads adding).
  - `test_unknown_label_removed_and_numbering_compacted`; `test_answer_without_valid_citation_is_not_found`; `test_none_reply_is_could_not_finish`; `test_greeting_help_out_of_scope_fixed_texts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add retrieval, source labels and citation check`.

### Task 4: Orchestrator agent, tools and chat graph

**Files:**
- Create: `backend/app/agents/chat_context.py`, `backend/app/agents/tools.py`, `backend/app/agents/chat_graph.py`, `backend/app/agents/prompts/orchestrator.md`, `…/chat_merge.md`
- Modify: `backend/app/agents/schemas.py` (add `ChatSummaryItem`, `ChatSummaryActionItem`, `ChatSummary`)
- Test: `backend/tests/agents/test_tools.py`, `backend/tests/agents/test_chat_graph.py`

**Interfaces:**
- Consumes: Tasks 1–3; stored analysis rendered with `render_analysis` (foundation Task 8).
- Produces:
  - `ChatContext(db_path: Path, embedder: Embedder, settings: Settings, models: ModelsRegistry, scope, tag_ids: list[str], today: date, sources: SourceRegistry)` (`models` is what `summarize` passes to `build_agent`; `sources` is the run's label registry).
  - `ChatSummaryItem(text: str, sources: list[str] = Field(min_length=1, max_length=3))` (labels such as `"P3"`, `"R1"`), `ChatSummaryActionItem(ChatSummaryItem)` with `owner: str | None` and `due: str | None`, `ChatSummary(overview: str, decisions: list[ChatSummaryItem], action_items: list[ChatSummaryActionItem], open_questions: list[ChatSummaryItem])`, in `app/agents/schemas.py`. Labels are validated against the run's `SourceRegistry`: unknown labels dropped, an item left with none dropped.
  - Tools (each opens its own connection, sees only `ready` recordings within scope and tags, writes a status line through `runtime.stream_writer`, returns text wrapped in `<sources>` with escaping):
    - `search_transcripts(query: str, k: int = 8, *, runtime: ToolRuntime[ChatContext]) -> str` ("Searching meetings…" / "Searching notes…" / "Searching recordings…", then "Found N passages"); each passage `[Pn] <title> · <date> · <mm:ss>` then lines with current speaker names ("Sarah (Speaker A): …").
    - `find_recordings(text: str | None = None, date_from: str | None = None, date_to: str | None = None, tags: list[str] | None = None, *, runtime) -> str` ("Looking up recordings…"): `[Rn] <title> · <date> · <duration> · <tags> · <overview or first key point>`.
    - `summarize(sources: list[str], focus: str | None = None, *, runtime) -> str` ("Summarizing N recordings…"): labels only (`Rn`, or `Pn` → its recording); one recording → its stored summary or key points rendered, items registered as passages (no model call); several → one `ChatSummary` call through `build_agent(runtime.context.models, "llm", …, extra_middleware=[ForceOutputToolMiddleware(from_turn=1)])` with `chat_merge.md` over the rendered stored summaries, its items citing the given labels. A recording not ready → "not ready yet".
  - The Orchestrator's forced final answer is `ForceOutputToolMiddleware(from_turn=6)` (Task 1).
  - `dynamic_prompt` middleware adding today's date and the scope.
  - `build_chat_graph(container) -> CompiledStateGraph` (called on first use, not by `build_container`): `StateGraph` with nodes `orchestrator` (the agent from `build_agent(container.models, "llm", name="orchestrator", tools=[…], schema=ChatReply, context_schema=ChatContext, extra_middleware=[ForceOutputToolMiddleware(from_turn=6), dynamic prompt, ModelCallLimitMiddleware(run_limit=7, exit_behavior="end"), ToolCallLimitMiddleware(run_limit=4)])`) → `check_citations` → END. Graph state carries `messages`, `structured_response`, `final: FinalReply`. Input: the question plus the last 6 turns of history, past citations rendered as "(Budget sync, 12:04)".
  - Streaming (used by Task 5 and the tests): `graph.astream(input, context=ctx, stream_mode=["custom", "values"], subgraphs=True)`. With `subgraphs=True` every chunk is `(namespace, mode, payload)`; every `custom` payload is a status line (from any namespace, since the tools run inside the orchestrator subgraph); `values` payloads count only when `namespace == ()` (the outer graph's state, whose last one holds `final`). Without `subgraphs=True` the tools' custom events never reach the caller (verified on langgraph 1.2.16).

- [ ] **Step 1: Write the failing tests** (scripted model; seeded DB):
  - `test_search_tool_scope_and_status_lines`: a scripted model calls `search_transcripts` then answers; steps are captured through `build_chat_graph(...)` with the streaming call above (not by calling the tool alone) → "Searching meetings…" then "Found N passages", in order; scope `notes` returns no meeting passages.
  - `test_summarize_one_recording_no_model_call`; `test_summarize_accepts_p_label`; `test_summarize_not_ready`; `test_summarize_several_drops_unknown_labels` (scripted `ChatSummary` citing `R1` and an unknown `R9` → `R9` dropped; an item citing only `R9` dropped).
  - `test_final_answer_forced_on_sixth_turn`: a model that always calls `search_transcripts` until it is offered only the output tool → on the 6th call the recorded bound tools are exactly the `ChatReply` output-schema tool with `tool_choice == "any"`; run ends with a `FinalReply`.
  - `test_graph_answer_with_citations`: model calls search, then `ChatReply` citing `[P1]` → final text with `[1]` and one citation `{recording_id, segment_id, start_ms}`.
  - `test_graph_citing_unknown_label_is_not_found`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (orchestrator prompt per chat spec §3). **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add the orchestrator agent and chat graph`.

### Task 5: Chat endpoints and runs

**Files:**
- Create: `backend/app/chats/__init__.py`, `backend/app/chats/store.py`, `backend/app/chats/runs.py`
- Modify: `backend/app/api/routes/chats.py` (all five handlers; `ask_chat`, `retry_run` become `async def`), `backend/app/container.py` (field `chat_runs: "ChatRuns | None" = None`, `ChatRuns` imported only under `TYPE_CHECKING`; set in `build_container` after the container is constructed), `backend/tests/conftest.py` (sets `chat_runs` on the fixture's replaced container)
- Test: `backend/tests/chats/test_store.py`, `backend/tests/chats/test_runs_api.py`

**Interfaces:**
- Consumes: Task 4; `get_db` (foundation Task 8).
- Import cycles: `app/chats/runs.py` must not import the container or the worker at module level (the container module imports `app.processing.fakes`, which runs `app/processing/__init__.py`): `Container` only under `TYPE_CHECKING`; `build_container` imports `ChatRuns` late, inside the function.
- Test fixture: `dataclasses.replace` copies `chat_runs`, which would still point at the container built before the replace (real embedder and analyzer). So the fixture builds `ChatRuns` after the replace, on the replaced container: `result = dataclasses.replace(built, analyzer=FakeAnalyzer(), …, chat_runs=None)`, then `result.chat_runs = ChatRuns(result, build_chat_graph)`.
- Produces:
  - `store.py`: `create_chat(conn) -> ChatOut`; `get_chat(conn, chat_id) -> ChatDetailOut` (404 if missing); `add_user_message(conn, chat_id, ask: AskIn) -> str` (msg id); `add_assistant_message(conn, chat_id, final: FinalReply) -> MessageOut`; `history_for(conn, chat_id, before_msg_id, turns=6) -> list[BaseMessage]` (citations rendered as plain text).
  - `runs.py`: `RunState(status, steps: list[str], message: MessageOut | None, error: ErrorBody | None)`; `class ChatRuns(container, graph_factory)`: `start(chat_id, msg_id) -> None`: creates an asyncio task and keeps a strong reference to it on the `RunState` (the event loop holds only weak references); the task runs `graph.astream(input, context=ctx, stream_mode=["custom", "values"], subgraphs=True)` (Task 4) under `asyncio.timeout(settings.chat_deadline_s)`; each chunk is `(namespace, mode, payload)`: every `custom` payload is appended to `steps` as it arrives, and only `values` payloads with `namespace == ()` are kept, the last one giving the final reply (`ainvoke` returns no custom events); "Writing answer…" is added before `check_citations`; the graph is built on the first run; on success stores the assistant message → `done`; OpenAI/LLM errors and `ConfigError` (missing key) → `failed` `ai_unavailable` "Couldn't reach the AI right now."; any other exception → `failed` `internal_error`, logged; deadline → `failed` `timed_out` "That took too long."; `get(run_id) -> RunState | None`; `retry(chat_id, run_id)` allowed when the run failed or is unknown (restart) and the user message exists; an unknown run whose assistant reply is already stored (the server restarted after storing it) is not re-run: it becomes a `done` run holding that existing message; 409 `not_failed` while running or done.
  - Routes: `POST /chats` 201; `GET /chats/{id}`; `POST …/messages` stores the user message, starts the run, 202 `{run_id: <msg id>}`; `GET …/runs/{run_id}` → `RunOut`, 404 `not_found` when unknown (the app shows "Interrupted"); `POST …/runs/{run_id}/retry` → 202 same `run_id`, the user message is not stored again.

- [ ] **Step 1: Write the failing tests** (graph factory replaced with scripted models). Use `with TestClient(app) as client:`: without the context manager each request runs on a short-lived event loop and the background run is cancelled when the request returns.
  - `test_ask_then_poll_done_with_steps_and_citations` (steps include the search tool's status lines, proving `subgraphs=True`).
  - `test_all_models_fail_run_failed_ai_unavailable`; `test_tool_bug_is_internal_error_not_ai_unavailable`.
  - `test_deadline_times_out` (`chat_deadline_s=0.2`, a model that sleeps).
  - `test_unknown_run_404_then_retry_reuses_message` (user message count stays 1).
  - `test_retry_unknown_run_with_stored_reply_returns_it` (assistant message already stored, run unknown → retry → `done` with that message; graph not called; assistant message count stays 1).
  - `test_retry_while_running_409`.
  - `test_history_renders_citations_without_labels`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; checks clean; `export-openapi --check` passes (handlers changed to async; shapes unchanged).
- [ ] **Step 5: Commit** `feat(backend): add chat endpoints with polled runs`.

### Task 6: Provider smoke test and relevance calibration (manual tools)

**Files:**
- Create: `backend/app/llm/smoke.py`, `backend/app/rag/calibrate.py`, `docs/calibration-questions.example.yaml`
- Modify: `backend/app/cli.py` (`smoke-llm`, `calibrate-retrieval`), `docs/setup.md` (how to run both)
- Test: `backend/tests/llm/test_smoke_cli.py` (argument parsing and the report format with fakes only)

**Interfaces:**
- Produces:
  - `python -m app.cli smoke-llm`: for each provider, `GET <base_url>/models` (prints whether each configured model id exists); then per `llm` entry: one Orchestrator question with a tool call, and one forced final turn: a request with earlier tool calls and tool results in the history, only the `ChatReply` tool bound and `tool_choice="required"` (what langchain-openai sends for the `"any"` that `ToolStrategy` binds), reporting whether the provider accepts it and returns the tool call; per `llm_analysis` entry: one Summarizer call on a built-in sample transcript. Prints pass/fail and token usage per call; never prints keys.
  - `python -m app.cli calibrate-retrieval --questions <yaml>`: for each question (`text`, `expect_recording_title` or `unrelated: true`), prints the best distances; suggests the `retrieval_max_distance` that keeps every expected hit and drops unrelated ones.
- [ ] **Step 1: Write the failing tests** (CLI wiring with fakes). **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add provider smoke test and retrieval calibration commands`.
- [ ] **Step 6 (manual, lead; in the plan issue's lead checklist):** with real keys, run `smoke-llm`; fix model ids in `config/models.yaml` if any is missing; if a provider rejects `tool_choice="required"` with tool history, open a Decision issue (that provider cannot serve the forced final turn) instead of patching around it. After demo recordings exist, run `calibrate-retrieval` and set `retrieval_max_distance`. Record results in the plan issue.

## Shared files with the processing plan
Both plans edit `backend/app/container.py` (binding points; this plan adds the analyzer binding and `chat_runs`), `backend/tests/conftest.py` (the fixture's `dataclasses.replace` with fakes; this plan also sets `chat_runs`), `backend/app/cli.py`, `docs/setup.md`, `backend/pyproject.toml` and `backend/uv.lock`. Whichever merges second rebases and keeps both changes. A `uv.lock` conflict is resolved by taking either side and re-running `uv lock`, never by hand-merging the file.

## Self-review notes
- Spec coverage: registry and factory (chat §1) Task 1; Summarizer and map-reduce (processing §4, model side) Task 2; retrieval (chat §5) and citation check (chat §4) Task 3; Orchestrator, tools, final answer, graph (chat §2–§4) Task 4; runs and failures (chat §6, data-API chats routes) Task 5; smoke test and calibration (chat §1, §5) Task 6.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 none (needs the processing plan's chunk format; seeds its own rows); Task 4 needs 1 and 3; Task 5 needs 4; Task 6 needs 2 and 4. Tasks 1 and 3 can run in parallel. Foundation Task 8 must be merged first.
