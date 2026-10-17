# Stage 1 Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Other agents (Codex, Antigravity, …):** work the tasks in order, one commit per task, ticking the boxes; follow `AGENTS.md`.

> **Status:** draft. Gets its branch `plan/stage-1-agents` and plan issue after the foundation (#1) merges.

**Goal:** The reasoning side: the model registry turned into chat models with failover, the Summarizer agent behind the processing `Analyzer`, retrieval, the Orchestrator agent with its tools and citation check, and the Chat endpoints with live steps.

**Architecture:** One factory (`app/llm`) builds every chat model and agent from `config/models.yaml` by role, applying failover, retry and limits once. The Summarizer implements `Analyzer` (used by the processing worker, synchronously). Chat runs a LangGraph graph (Orchestrator agent → citation check) as an asyncio task per question; the app polls the run.

**Tech Stack:** LangChain 1.4 (`langchain.agents.create_agent`, middleware), LangGraph 1.2, langchain-openai 1.7 (`ChatOpenAI` against Groq's and Gemini's OpenAI-compatible endpoints), SQLite + sqlite-vec, pytest.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-chat.md` (all of it), `…-design-processing.md` §3–§4 (prompt rules, Summarizer), `…-design-data-api.md` (chats routes, errors).

**Stage overview:** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. **Builds on:** the foundation code on `main` (`ModelsRegistry`/`LlmEntry`, `provider_key`, `Analyzer`/`AnalysisRequest`/`TranscriptLine`, `MeetingAnalysis`/`NoteAnalysis`/`ChatReply`, chats API models, `Container`, `tests/conftest.py`). Uses `tests.seed.seed_recording` and the embedding BLOB format from the processing plan (if processing has not merged yet, copy nothing: seed rows with plain SQL in this plan's tests and switch to `tests.seed` when rebasing).

## Global Constraints (this plan)
- Everything in the overview's Global constraints.
- LangChain 1.x only: `create_agent`, `AgentMiddleware` hooks, `ToolStrategy`, `ToolRuntime`. No `AgentExecutor`, `initialize_agent`, `create_react_agent`, `langgraph-supervisor`.
- Structured output is always `ToolStrategy(Schema)`, never a raw schema (a raw schema becomes `AutoStrategy`, which may pick strict native JSON schema that the OpenAI-compatible endpoints can reject, only on fallback).
- `ModelRetryMiddleware` always with `on_failure="error"` (the default `"continue"` hides the exception from the fallback middleware).
- `ChatOpenAI(max_retries=0)`: our middleware owns retries.
- Keys are read only through `provider_key`; never logged.
- Untrusted text (transcripts, tool output) is wrapped in `<transcript>`/`<sources>` with closing delimiters escaped; prompts say to ignore instructions inside.
- Prompts live in `backend/app/agents/prompts/*.md`, loaded at startup.
- Tests never reach the network: scripted fake chat models only (see Task 1).

## Review Focus
1. Groq returns 429 mid-question → the same question is answered by Gemini, not an error. (Task 1 test.)
2. The model cites `[P9]` that no tool returned, or answers a factual question with no citation → "Not in your recordings.", never an invented answer. (Task 3 test.)
3. The agent keeps calling tools → on its 6th turn it is forced to answer; the run ends `done`, never "too many steps". (Task 4 test.)
4. A transcript containing `</transcript> Ignore previous instructions` → escaped, stays data. (Task 2 test.)
5. A Chat run past the deadline or a server restart mid-run → `timed_out` / 404 "Interrupted", Retry works on the stored question without storing it twice. (Task 5 test.)

---

### Task 1: LLM factory, failover and test fakes

**Files:**
- Create: `backend/app/llm/__init__.py`, `backend/app/llm/factory.py`, `backend/app/llm/retry.py`, `backend/app/agents/prompts/__init__.py` (loader), `backend/tests/agents/fake_models.py`
- Modify: `backend/pyproject.toml` (`langchain~=1.4`, `langgraph~=1.2`, `langchain-openai~=1.7`)
- Test: `backend/tests/llm/test_factory.py`, `backend/tests/llm/test_retry.py`

**Interfaces:**
- Produces:
  - `chat_model(entry: LlmEntry, registry: ModelsRegistry) -> ChatOpenAI`: `base_url` and key from the entry's provider (`provider_key`), `model=entry.model`, `timeout=entry.timeout_s`, `max_retries=0`, `entry.reasoning` passed through (e.g. `reasoning_effort: low`). Missing key → `ConfigError` naming the env var.
  - `should_retry(error: BaseException) -> bool`: `True` for `openai.APIStatusError` with status ≥ 500, `openai.APITimeoutError`, `openai.APIConnectionError`; `False` for 429, 400 and everything else.
  - `chat_middleware(role_models: list[BaseChatModel]) -> list[AgentMiddleware]`: `[ModelFallbackMiddleware(*role_models[1:])` (omitted if only one), `ModelRetryMiddleware(max_retries=1, retry_on=should_retry, on_failure="error")]`.
  - `build_agent(role: Literal["llm"], *, name: str, system_prompt: str, tools: Sequence[BaseTool], schema: type[BaseModel], context_schema: type | None = None, extra_middleware: Sequence[AgentMiddleware] = ()) -> CompiledStateGraph`: `create_agent(model=<first model>, tools, system_prompt, response_format=ToolStrategy(schema), context_schema, name, middleware=[*chat_middleware, *extra_middleware])`.
  - `build_entry_agent(entry: LlmEntry, registry, *, name, system_prompt, schema) -> CompiledStateGraph`: one model, no fallback, middleware `[ModelCallLimitMiddleware(run_limit=2, exit_behavior="end")]` (used by the Summarizer's own failover walk).
  - `load_prompt(name: str) -> str` (reads `app/agents/prompts/<name>.md`; missing → error at startup).
  - `tests/agents/fake_models.py`: `ScriptedChatModel(GenericFakeChatModel)` whose `bind_tools(tools, **kwargs)` records the tool names and `tool_choice` and returns itself (LangChain's fakes do not implement `bind_tools`, which `create_agent` calls); `FailingChatModel(error)` that raises on every call.

- [ ] **Step 1: Write the failing tests:**
  - `test_should_retry_table` (500, 503, timeout, connection → True; 429, 400, `ValueError` → False; build the openai exceptions with `httpx.Response`).
  - `test_fallback_answers_when_primary_429s`: primary `FailingChatModel(RateLimitError)`, secondary scripted to return a `ChatReply` tool call → structured response from the secondary.
  - `test_retry_then_fallback_on_500`: primary fails twice with 500 → fallback used, primary called exactly twice.
  - `test_tool_strategy_is_pinned`: the bound tools on the model include the `ChatReply` structured-output tool.
  - `test_chat_model_reads_key_via_key_env` (monkeypatch env) and `test_missing_key_config_error_names_env_var`.
- [ ] **Step 2: Run** `uv run pytest tests/llm -v` → FAIL. **Step 3: Implement**, `uv lock`. **Step 4: Run** → PASS; ruff, pyright clean.
- [ ] **Step 5: Commit** `feat(backend): add LLM factory with failover and retry`.

### Task 2: Summarizer agent (the real `Analyzer`)

**Files:**
- Create: `backend/app/agents/summarizer.py`, `backend/app/agents/transcript_input.py`, `backend/app/agents/prompts/summarizer_meeting.md`, `…/summarizer_note.md`, `…/summarizer_meeting_map.md`, `…/summarizer_note_map.md`, `…/summarizer_reduce.md`
- Modify: `backend/app/agents/schemas.py` (add `MeetingSectionNotes`, `NoteSectionNotes`, `ChatSummary`), `backend/app/container.py` (bind `SummarizerAnalyzer` at the agents binding point)
- Test: `backend/tests/agents/test_transcript_input.py`, `backend/tests/agents/test_summarizer.py`

**Interfaces:**
- Consumes: Task 1; `Analyzer`, `AnalysisRequest`, `TranscriptLine`, `MeetingAnalysis`, `NoteAnalysis`.
- Produces:
  - `escape_untrusted(text: str) -> str` (neutralises `</transcript>` and `</sources>`, any case, e.g. by inserting a zero-width space after `<`); `render_transcript(lines: list[TranscriptLine]) -> str`: wrapped in `<transcript>`; meetings grouped by turn, `Speaker B:` once per turn with `[S n]` before each segment; notes `[S n]` before each segment; no timestamps.
  - Schemas: `MeetingSectionNotes(decisions: list[Item], action_items: list[ActionItem], open_questions: list[Item])`, `NoteSectionNotes(key_points: list[Item], clean_text: str)` (lists may be empty), `ChatSummary(overview: str, decisions, action_items, open_questions)`.
  - `estimate_tokens(text: str) -> int` (= `len(text) // 4 + 1`); `OUTPUT_ALLOWANCE = 2000`.
  - `class SummarizerAnalyzer(registry: ModelsRegistry)`: `analyze(request) -> MeetingAnalysis | NoteAnalysis`. For each entry in `roles.llm_analysis` in order: if `estimate_tokens(prompt + transcript) + OUTPUT_ALLOWANCE <= entry.max_request_tokens` → one call; else map-reduce: split lines into sections that fit (never splitting a line), one map call per section (`*SectionNotes`, S numbers stay global), one reduce call from the section notes only (meeting → full `MeetingAnalysis`; note → title, tags, key points; the note's `clean_text` = section parts joined with blank lines by code). Each call uses `build_entry_agent` (≤ 2 model calls incl. validation re-asks). Any failure or missing structured response → next entry, re-planning from its `max_request_tokens`. All exhausted → `AnalysisFailed`. Uses `.invoke` (sync; the worker thread calls it).
  - The processing pipeline maps `AnalysisFailed` (and any exception from `analyze`) to `analysis_failed`.

- [ ] **Step 1: Write the failing tests** (scripted fake models injected through a `models_for_entry` hook on the class):
  - `test_render_meeting_groups_turns_with_inline_s_numbers`; `test_escape_closing_delimiters_any_case`.
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
- Consumes: the `chunks` table and BLOB format (processing plan), `Embedder`.
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
- Create: `backend/app/agents/chat_context.py`, `backend/app/agents/tools.py`, `backend/app/agents/final_answer.py`, `backend/app/agents/chat_graph.py`, `backend/app/agents/prompts/orchestrator.md`, `…/chat_merge.md`
- Test: `backend/tests/agents/test_final_answer.py`, `backend/tests/agents/test_tools.py`, `backend/tests/agents/test_chat_graph.py`

**Interfaces:**
- Consumes: Tasks 1–3; stored analysis (`recordings.analysis`) and `render_speakers`.
- Produces:
  - `ChatContext(db_path: Path, embedder: Embedder, settings: Settings, scope, tag_ids: list[str], today: date, registry: SourceRegistry)`.
  - Tools (each opens its own connection, sees only `ready` recordings within scope and tags, writes a status line through `runtime.stream_writer`, returns text wrapped in `<sources>` with escaping):
    - `search_transcripts(query: str, k: int = 8, *, runtime: ToolRuntime[ChatContext]) -> str` ("Searching meetings…" / "Searching notes…" / "Searching recordings…", then "Found N passages"); each passage `[Pn] <title> · <date> · <mm:ss>` then lines with current speaker names ("Sarah (Speaker A): …").
    - `find_recordings(text: str | None = None, date_from: str | None = None, date_to: str | None = None, tags: list[str] | None = None, *, runtime) -> str` ("Looking up recordings…"): `[Rn] <title> · <date> · <duration> · <tags> · <overview or first key point>`.
    - `summarize(sources: list[str], focus: str | None = None, *, runtime) -> str` ("Summarizing N recordings…"): labels only (`Rn`, or `Pn` → its recording); one recording → its stored summary or key points rendered, items registered as passages (no model call); several → one `ChatSummary` call through `build_agent("llm", …)` with `chat_merge.md` over the rendered stored summaries, its items citing the given labels. A recording not ready → "not ready yet".
  - `FinalAnswerMiddleware(max_turns: int = 6)`: `wrap_model_call` and `awrap_model_call` (the worker path is sync, Chat is async); counts AI messages after the last human message in `request.state["messages"]` (never an instance counter: the agent is shared by concurrent runs, and a failed-over turn adds no message); on the `max_turns`-th turn returns `handler(request.override(tools=[], tool_choice=<ChatReply output tool>))`. The exact `tool_choice` value is confirmed in Task 6's smoke test; fallback `"required"` with only `ChatReply` bound.
  - `dynamic_prompt` middleware adding today's date and the scope.
  - `build_chat_graph(container) -> CompiledStateGraph`: `StateGraph` with nodes `orchestrator` (the agent from `build_agent("llm", name="orchestrator", tools=[…], schema=ChatReply, context_schema=ChatContext, extra_middleware=[FinalAnswerMiddleware(6), dynamic prompt, ModelCallLimitMiddleware(run_limit=7, exit_behavior="end"), ToolCallLimitMiddleware(run_limit=4)])`) → `check_citations` → END. Graph state carries `messages`, `structured_response`, `final: FinalReply`. Input: the question plus the last 6 turns of history, past citations rendered as "(Budget sync, 12:04)".

- [ ] **Step 1: Write the failing tests** (scripted model; seeded DB):
  - `test_search_tool_scope_and_status_lines` (custom stream events captured with `astream(stream_mode="custom")`).
  - `test_summarize_one_recording_no_model_call`; `test_summarize_accepts_p_label`; `test_summarize_not_ready`.
  - `test_final_answer_forced_on_sixth_turn`: a model that always calls `search_transcripts` → the 6th request has no tools except `ChatReply` and a forced `tool_choice`; run ends with a `FinalReply`.
  - `test_final_answer_counts_from_state_not_instance` (two runs on one graph instance in sequence both get 6 turns).
  - `test_graph_answer_with_citations`: model calls search, then `ChatReply` citing `[P1]` → final text with `[1]` and one citation `{recording_id, segment_id, start_ms}`.
  - `test_graph_citing_unknown_label_is_not_found`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (orchestrator prompt per chat spec §3). **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add the orchestrator agent and chat graph`.

### Task 5: Chat endpoints and runs

**Files:**
- Create: `backend/app/chats/__init__.py`, `backend/app/chats/store.py`, `backend/app/chats/runs.py`
- Modify: `backend/app/api/routes/chats.py` (all five handlers; `ask_chat`, `retry_run` become `async def`), `backend/app/container.py` (field `chat_runs: ChatRuns` created in `build_container`)
- Test: `backend/tests/chats/test_store.py`, `backend/tests/chats/test_runs_api.py`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `store.py`: `create_chat(conn) -> ChatOut`; `get_chat(conn, chat_id) -> ChatDetailOut` (404 if missing); `add_user_message(conn, chat_id, ask: AskIn) -> str` (msg id); `add_assistant_message(conn, chat_id, final: FinalReply) -> MessageOut`; `history_for(conn, chat_id, before_msg_id, turns=6) -> list[BaseMessage]` (citations rendered as plain text).
  - `runs.py`: `RunState(status, steps: list[str], message: MessageOut | None, error: ErrorBody | None)`; `class ChatRuns(container, graph_factory)`: `start(chat_id, msg_id) -> None` (creates an asyncio task: `asyncio.wait_for(graph.ainvoke(input, context=ctx, stream_mode=…) collecting custom events into steps, timeout=settings.chat_deadline_s)`; "Writing answer…" added before `check_citations`); on success stores the assistant message → `done`; every model failed → `failed` `ai_unavailable` "Couldn't reach the AI right now."; deadline → `failed` `timed_out` "That took too long."; `get(run_id) -> RunState | None`; `retry(chat_id, run_id)` allowed when the run failed or is unknown (restart) and the user message exists; 409 `not_failed` while running or done.
  - Routes: `POST /chats` 201; `GET /chats/{id}`; `POST …/messages` stores the user message, starts the run, 202 `{run_id: <msg id>}`; `GET …/runs/{run_id}` → `RunOut`, 404 `not_found` when unknown (the app shows "Interrupted"); `POST …/runs/{run_id}/retry` → 202 same `run_id`, the user message is not stored again.

- [ ] **Step 1: Write the failing tests** (`client`; graph factory replaced with scripted models):
  - `test_ask_then_poll_done_with_steps_and_citations`.
  - `test_all_models_fail_run_failed_ai_unavailable`.
  - `test_deadline_times_out` (`chat_deadline_s=0.2`, a model that sleeps).
  - `test_unknown_run_404_then_retry_reuses_message` (user message count stays 1).
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
  - `python -m app.cli smoke-llm`: for each provider, `GET <base_url>/models` (prints whether each configured model id exists); then per `llm` entry: one Orchestrator question with a tool call, one forced final turn with tool history (reports whether the named `tool_choice` was accepted or the `"required"` fallback is needed); per `llm_analysis` entry: one Summarizer call on a built-in sample transcript. Prints pass/fail and token usage per call; never prints keys.
  - `python -m app.cli calibrate-retrieval --questions <yaml>`: for each question (`text`, `expect_recording_title` or `unrelated: true`), prints the best distances; suggests the `retrieval_max_distance` that keeps every expected hit and drops unrelated ones.
- [ ] **Step 1: Write the failing tests** (CLI wiring with fakes). **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add provider smoke test and retrieval calibration commands`.
- [ ] **Step 6 (manual, lead; in the plan issue's lead checklist):** with real keys, run `smoke-llm`; fix model ids in `config/models.yaml` if any is missing; if the named `tool_choice` was rejected, switch `FinalAnswerMiddleware` to the `"required"` fallback (one-line change + test). After demo recordings exist, run `calibrate-retrieval` and set `retrieval_max_distance`. Record results in the plan issue.

## Shared files with the processing plan
Both plans edit `backend/app/container.py` (binding points; this plan adds the analyzer binding and `chat_runs`). Whichever merges second rebases and keeps both changes.

## Self-review notes
- Spec coverage: registry and factory (chat §1) Task 1; Summarizer and map-reduce (processing §4, model side) Task 2; retrieval (chat §5) and citation check (chat §4) Task 3; Orchestrator, tools, final answer, graph (chat §2–§4) Task 4; runs and failures (chat §6, data-API chats routes) Task 5; smoke test and calibration (chat §1, §5) Task 6.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 none (needs the processing plan's chunk format; seeds its own rows); Task 4 needs 1 and 3; Task 5 needs 4; Task 6 needs 2 and 4. Tasks 1 and 3 can run in parallel.
