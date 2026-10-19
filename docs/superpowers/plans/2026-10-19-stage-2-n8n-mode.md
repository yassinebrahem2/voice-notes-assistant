# n8n Mode Implementation Plan

> **For agentic workers:** implement this plan task by task as described in `docs/implementing-plan-tasks.md` (fresh implementer, fresh reviewer, fix loop per task); follow `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** approved. Branch `plan/stage-2-n8n-mode`. Standalone plan (no stage-2 overview). Task 3 has no code dependency and goes first, so the lead can import and try the workflows while Tasks 1–2 are built.

**Goal:** An add-on n8n mode (`AI_BACKEND=n8n`) in which analysis, embedding and the Chat agent run as n8n workflows with Gemini, while builtin mode (the default) stays exactly as it is.

**Architecture:** New code only, in `backend/app/n8n/` and `n8n/`. A small client calls n8n webhooks; `N8nAnalyzer` and `N8nEmbedder` plug into the existing `Analyzer`/`Embedder` seams; a new LangGraph graph (`n8n_agent → check_citations`) plugs into `ChatRuns`' existing graph factory; callback routes let the n8n agent call the existing LangGraph tools. Three `if n8n` branches switch it on.

**Tech Stack:** FastAPI, httpx (`Client`/`AsyncClient`, `MockTransport` in tests), pydantic-settings, LangGraph 1.2, n8n 2.1.4 in Docker, Gemini.

**Spec:** `docs/superpowers/specs/2026-10-18-n8n-mode-design.md` (all of it).

## Global Constraints
- Builtin mode is untouched: no existing module is refactored, moved or changed in behaviour. The only edits to existing files are: `app/config/settings.py` (one field), `app/container.py` (one `if` branch and one optional `n8n` field on `Container`, default `None`), `app/api/app.py` (one `if` branch), `backend/.env.example` (commented lines), `docs/setup.md` (new section). Every existing test passes unchanged.
- Builtin mode imports nothing from `app.n8n`: every `app.n8n` import sits inside the n8n branch (lazy, like `build_chat_graph` today). `app.n8n.chat_graph` imports `app.agents.chat_graph`, which imports `app.container`; a top-level import would be circular.
- Existing code is reused by import, never copied or edited: `render_transcript`, `load_prompt`, `SummarizerAnalyzer` helpers, `ChatState`, `check_citations_node`, the tools in `app/agents/tools.py`, `ChatReply`/`MeetingAnalysis`/`NoteAnalysis`.
- `config/models.yaml`, `docs/roadmap.md`, `openapi.json` and the mobile app do not change. `uv run python -m app.cli export-openapi --check` stays clean.
- Secrets: `N8N_SHARED_SECRET` is read from the environment as `SecretStr` and never logged, put in a `repr`, an error message or a test fixture other than a dummy like `"test-secret"`.
- Tests never reach the network: httpx `MockTransport` only. New test files have unique basenames prefixed `test_n8n_` and no `__init__.py` (the sibling test directories have none; pytest's default import mode needs unique names). n8n tests `delenv` every `N8N_*` and `AI_BACKEND` variable (the shared conftest does not).
- Header name `X-N8N-Secret`; webhook paths `analyze`, `embed`, `chat`; callback routes `/internal/n8n/tools/{search_transcripts,find_recordings,summarize}`; embedding model `gemini-embedding-001`, 768 dimensions, at most 100 texts per call.

## Review Focus
1. n8n is down or a workflow is not active (404) during Chat → the run fails with `ai_unavailable` ("Couldn't reach the AI right now."), not `internal_error`. (Task 1 client test, Task 2 graph test.)
2. A slow n8n Chat answer → the run ends `timed_out` at the chat deadline, never `ai_unavailable` from an earlier per-call timeout. (Task 2 test.)
3. The n8n agent cites a label no callback handed out → the citation check rejects it as in builtin mode. (Task 2 test.)
4. A callback arrives after its run finished, or with a wrong secret → 404 / 401, never another run's data. (Task 2 tests.)
5. Builtin mode with no n8n settings at all → starts, imports nothing from `app.n8n`, `openapi.json` unchanged. (Task 2 test.)

---

### Task 1: n8n client, settings, analyzer and embedder

**Files:**
- Create: `backend/app/n8n/__init__.py` (empty), `backend/app/n8n/settings.py`, `backend/app/n8n/client.py`, `backend/app/n8n/analyzer.py`, `backend/app/n8n/embedder.py`
- Modify: `backend/app/config/settings.py` (add `ai_backend`), `backend/.env.example`
- Test: `backend/tests/n8n/test_n8n_client.py`, `backend/tests/n8n/test_n8n_analyzer.py`, `backend/tests/n8n/test_n8n_embedder.py`

**Interfaces:**
- Produces:
  - `Settings.ai_backend: Literal["builtin", "n8n"] = "builtin"`
  - `class N8nSettings(BaseSettings)`: `n8n_url: str = "http://127.0.0.1:5678"`, `n8n_timeout_s: float = 60`, `n8n_embed_model: str = "gemini-embedding-001"`; reads the environment only (`_env_file=None`; `load_settings` has already loaded `backend/.env` into it).
  - `def shared_secret() -> SecretStr | None` (reads `N8N_SHARED_SECRET`, like `hf_token()`).
  - `class N8nUnavailable(ModelError)` (`langchain_core.exceptions.ModelError`, so `ChatRuns._is_ai_unavailable` already matches it), `class N8nBadResponse(Exception)`.
  - `class N8nClient`: `__init__(self, settings: N8nSettings, secret: SecretStr, *, transport: httpx.BaseTransport | None = None, async_transport: httpx.AsyncBaseTransport | None = None)`; `post(self, name: str, body: dict[str, object]) -> dict[str, object]` on an `httpx.Client(timeout=n8n_timeout_s)`; `async apost(self, name: str, body: dict[str, object]) -> dict[str, object]` on an `httpx.AsyncClient(timeout=None)` (httpx's 5 s default would cut a Gemini agent turn short; the chat deadline bounds it instead).
  - `def first_gemini_entry(registry: ModelsRegistry, entries: list[LlmEntry]) -> LlmEntry | None`: first entry whose provider has `client == "google_genai"`.
  - `class N8nAnalyzer(SummarizerAnalyzer)`: `__init__(self, registry: ModelsRegistry, client: N8nClient)`; `analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis`.
  - `class N8nEmbedder`: `__init__(self, client: N8nClient, model: str)`; `dim = 768`; `embed_passages(self, texts: Sequence[str]) -> list[list[float]]`; `embed_query(self, text: str) -> list[float]`.

- [ ] **Step 1: Write the failing client tests** (`test_n8n_client.py`, each with a `MockTransport` handler)
  - `test_client_timeouts`: the sync client's timeout is `httpx.Timeout(60)`, the async client's is `httpx.Timeout(None)`.
  - `test_post_sends_secret_header_and_json`: the request goes to `http://n8n.test/webhook/analyze`, has `X-N8N-Secret: test-secret`, and its JSON body equals what was passed; the reply JSON is returned.
  - `test_post_unwraps_output`: reply `{"output": {"a": 1}}` → returns `{"a": 1}`; reply `{"a": 1}` → returns it unchanged.
  - `test_unavailable_errors`: parametrized over a raised `httpx.ConnectError`, a raised `httpx.ReadTimeout`, status 500, status 404 → `N8nUnavailable`; for 404, the log record mentions "not active"; no message or log contains `test-secret`.
  - `test_bad_response`: status 400, and a 200 whose body is not a JSON object → `N8nBadResponse`.
  - `test_apost_same_mapping`: one success and one 503 through `apost` with an async `MockTransport`.
- [ ] **Step 2: Run** `uv run pytest tests/n8n/test_n8n_client.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** `settings.py` and `client.py` per the interfaces; add `ai_backend` to `Settings`; add to `.env.example` under the existing optional overrides: `# AI_BACKEND=`, `# N8N_URL=`, `# N8N_TIMEOUT_S=`, `# N8N_EMBED_MODEL=`, `# N8N_SHARED_SECRET=`.
- [ ] **Step 4: Write the failing analyzer and embedder tests**
  - `test_analyzer_sends_single_call_payload`: for a meeting request with two lines and vocabulary `["budget"]`, the `analyze` webhook body is `{"kind": "meeting", "model": <first google_genai entry of llm_analysis>, "system_prompt": load_prompt("summarizer_meeting"), "user_content": f"{render_transcript(lines)}\n\nExisting tags: budget"}`; a note request uses `summarizer_note`.
  - `test_analyzer_validates_by_kind`: a valid `MeetingAnalysis` reply → returned as `MeetingAnalysis`; for a `note` request the same reply fails validation.
  - `test_analyzer_retries_once`: first reply invalid (title over 60 chars), second valid → returns the second; two invalid → raises `N8nBadResponse`; `N8nUnavailable` is not retried.
  - `test_embedder_batches_and_keeps_order`: 230 texts → three `embed` calls of 100, 100, 30, each `{"model": "gemini-embedding-001", "texts": [...], "task": "RETRIEVAL_DOCUMENT"}`; returned vectors in input order; `embed_query` sends `task: "RETRIEVAL_QUERY"` with one text and returns one vector; a reply with the wrong vector count or length ≠ 768 → `N8nBadResponse`.
- [ ] **Step 5: Run** `uv run pytest tests/n8n -v` → the new tests FAIL.
- [ ] **Step 6: Implement** `analyzer.py` (overrides `analyze` only; builds the content with the inherited `_format_tags_text` and `render_transcript`, model id from `first_gemini_entry(registry, registry.roles.llm_analysis)`) and `embedder.py`.
- [ ] **Step 7: Run** `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright` → all pass, every pre-existing test unchanged.
- [ ] **Step 8: Commit** `feat(backend): add n8n client, analyzer and embedder`

### Task 2: n8n chat graph, callback routes and the switch
Depends on Task 1.

**Files:**
- Create: `backend/app/n8n/runs.py`, `backend/app/n8n/chat_graph.py`, `backend/app/n8n/routes.py`, `backend/app/n8n/wiring.py`
- Modify: `backend/app/container.py` (n8n branch), `backend/app/api/app.py` (n8n branch)
- Test: `backend/tests/n8n/conftest.py`, `backend/tests/n8n/test_n8n_chat_graph.py`, `backend/tests/n8n/test_n8n_routes.py`, `backend/tests/n8n/test_n8n_wiring.py`

**Interfaces:**
- Consumes: Task 1's `N8nClient`, `N8nSettings`, `shared_secret`, `first_gemini_entry`, `N8nAnalyzer`, `N8nEmbedder`.
- Produces:
  - `runs.py`: `register(ctx: ChatContext) -> str` (new `run_id` from `secrets.token_urlsafe(16)`; no new ID prefix), `lookup(run_id: str) -> ChatContext | None`, `unregister(run_id: str) -> None`; a module-level dict guarded by a `threading.Lock`.
  - `chat_graph.py`: `build_n8n_chat_graph(container: Container) -> CompiledStateGraph` taking its client from `container.n8n` (never building one), with nodes `n8n_agent → check_citations` on the existing `ChatState`/`ChatContext`, `check_citations` being the existing `check_citations_node`. The `n8n_agent` node: `runtime.stream_writer("Asking n8n…")`; registers `runtime.context`; posts `{"model", "run_id", "system_prompt", "prompt"}` to `chat` with `apost`; validates `ChatReply`; returns `{"structured_response": reply}`; unregisters in `finally`.
    - `system_prompt` = `load_prompt("orchestrator")` + `"\n\nToday's date: {today}\nScope: {scope}"` (what `DynamicPromptMiddleware` appends).
    - `prompt` = `state["messages"]` rendered one per line as `User: <text>` (HumanMessage) / `Assistant: <text>` (AIMessage).
    - `model` = `first_gemini_entry(registry, registry.roles.llm).model`.
  - `routes.py`: `def build_router(client: N8nClient, secret: SecretStr) -> APIRouter`, mounted at `/internal/n8n/tools`, `include_in_schema=False`.
    - Each route checks `X-N8N-Secret` with `hmac.compare_digest` (401), looks up `run_id` (404), builds `ToolRuntime(state={}, context=ctx, config={}, stream_writer=lambda _: None, tool_call_id="n8n", store=None, tools=[])`, and calls the existing tool's function (`assert tool.func is not None` / `assert tool.coroutine is not None` for pyright): `search_transcripts.func(query, k, runtime=…)`, `find_recordings.func(text, date_from, date_to, tags, runtime=…)` (sync `def` handlers), `await summarize.coroutine(sources, focus, runtime=…)` (`async def`).
    - Bodies: pydantic models `{run_id, query, k=8}`, `{run_id, text=None, date_from=None, date_to=None, tags=None}`, `{run_id, sources, focus=None}`. Response: `{"result": <tool text>}`.
  - `wiring.py`: `def build_n8n_parts(registry: ModelsRegistry) -> N8nParts` (dataclass: `client`, `analyzer`, `embedder`, `secret`); raises `ConfigError` when `shared_secret()` is `None` or either `llm`/`llm_analysis` has no `google_genai` entry.
  - `container.py`: inside `build_container`, `if settings.ai_backend == "n8n":` (lazy imports) take `analyzer`/`embedder` from `build_n8n_parts`, store the parts on the container via a new optional field `n8n: "N8nParts | None" = None` (type under `TYPE_CHECKING`), and build `ChatRuns(container, build_n8n_chat_graph)`; the `else` is today's code, unchanged.
  - `api/app.py`: after the existing loop, `if container.n8n is not None:` (lazy import) `app.include_router(build_router(container.n8n.client, container.n8n.secret))`.

- [ ] **Step 1: Write the fixture and the failing graph tests**
  - `tests/n8n/conftest.py`, fixture `n8n_container(container)`: an `N8nClient` with a sync and an async `MockTransport`, each dispatching on the URL path (`/webhook/embed`, `/webhook/chat`) to handlers a test can set; `dataclasses.replace` of the shared `container` with `N8nAnalyzer`, `N8nEmbedder` and `N8nParts` (secret `"test-secret"`), then `ChatRuns(c, build_n8n_chat_graph)` rebuilt on it, as the shared fixture does. The default `embed` handler returns one fixed 768-dim unit vector per text; tests seed chunks with `tests.seed.seed_chunk(..., vector=<that vector>)`, so search passes the default 0.436 cut-off.
  - In `test_n8n_chat_graph.py`:
  - `test_n8n_chat_answer_cites_registered_source`: the async mock handler calls `/internal/n8n/tools/search_transcripts` on the same app through `httpx.AsyncClient(transport=httpx.ASGITransport(app))` with the received `run_id`, then answers a `ChatReply` citing the returned `[P1]`; the run ends `done` with one citation resolving to the seeded segment; the steps include "Asking n8n…".
  - `test_unknown_label_rejected`: the reply cites `[P9]` with no tool call → the stored reply is the same text builtin's citation check produces for an unknown label.
  - `test_prompt_renders_history`: with two earlier turns, the webhook body's `prompt` holds `User: …` / `Assistant: …` lines then the question, and `system_prompt` ends with the date and scope lines.
  - `test_n8n_down_is_ai_unavailable`: transport raises `httpx.ConnectError` → run `failed`, `ai_unavailable`.
  - `test_slow_n8n_hits_deadline`: `chat_deadline_s` patched to 0.2, the handler sleeps 1 s → run `failed`, `timed_out`.
  - `test_run_unregistered_after_finish`: after the run ends, `lookup(run_id)` is `None`.
- [ ] **Step 2: Write the failing route and wiring tests**
  - `test_n8n_routes.py`: wrong or missing secret → 401; unknown `run_id` → 404; `find_recordings` and `summarize` with a registered context return the tool's text in `result`.
  - `test_n8n_wiring.py`: `ai_backend="n8n"` with secret and the current `models.yaml` → container has `N8nAnalyzer`, `N8nEmbedder`, and its `ChatRuns` graph factory is `build_n8n_chat_graph`; without `N8N_SHARED_SECRET` → `ConfigError`; with a registry lacking a `google_genai` entry → `ConfigError`; builtin mode → `container.n8n is None`, no `/internal` route on the app, and (run in a subprocess with `sys.executable -c …`) building the builtin container and app leaves no `app.n8n` module in `sys.modules`.
- [ ] **Step 3: Run** `uv run pytest tests/n8n -v` → the new tests FAIL.
- [ ] **Step 4: Implement** `runs.py`, `chat_graph.py`, `routes.py`, `wiring.py`, then the two branches in `container.py` and `api/app.py`.
- [ ] **Step 5: Run** `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `uv run python -m app.cli export-openapi --check` → all pass, every pre-existing test unchanged, `openapi.json` unchanged.
- [ ] **Step 6: Commit** `feat(backend): add n8n chat graph, callback routes and mode switch`

### Task 3: Workflow drafts, compose file and setup doc
No dependency: it uses only the payload and route shapes this plan pins. Done first. No CI test can run n8n; the lead's import on the laptop is the final check.

**Files:**
- Create: `n8n/workflows/analyze.json`, `n8n/workflows/embed.json`, `n8n/workflows/chat.json`, `n8n/compose.yaml`, `n8n/import.ps1`
- Modify: `docs/setup.md` (new section "n8n mode" at the end)

**Interfaces:**
- Consumes: the webhook payloads of Tasks 1–2 and the callback routes of Task 2, exactly as named there.

- [ ] **Step 1: Write the three workflow files** as n8n 2.1.4 exports, node by node as in spec §2, each with a fixed `"id"` (`vna-analyze`, `vna-embed`, `vna-chat`) so a re-import replaces it rather than duplicating a webhook path. In model and tool sub-nodes reference the Webhook with `$('Webhook').first()`, not `.item`:
  - Every Webhook: POST, path `analyze`/`embed`/`chat`, authentication Header Auth with credential name `n8n shared secret`, response mode "Using Respond to Webhook node".
  - LLM nodes: Google Gemini Chat Model, credential name `Gemini`, model `={{ $('Webhook').first().json.body.model }}`.
  - `analyze`: Switch on `body.kind`; per branch a Basic LLM Chain (system message `body.system_prompt`, prompt `body.user_content`) with a Structured Output Parser holding the JSON schema of `MeetingAnalysis` / `NoteAnalysis` (generated with `Model.model_json_schema()`, `$defs` inlined, pasted in); Respond to Webhook with `={{ $json.output }}`.
  - `embed`: HTTP Request POST `https://generativelanguage.googleapis.com/v1beta/models/{{ body.model }}:batchEmbedContents`, predefined credential `Gemini`, JSON body `={{ { requests: $('Webhook').first().json.body.texts.map(t => ({ model: 'models/' + $('Webhook').first().json.body.model, content: { parts: [{ text: t }] }, taskType: $('Webhook').first().json.body.task, outputDimensionality: 768 })) } }}`; Respond to Webhook with `={{ { vectors: $json.embeddings.map(e => e.values) } }}`.
  - `chat`: AI Agent (system message `body.system_prompt`, prompt `body.prompt`, max iterations 6, output parser on) with Gemini Chat Model, Structured Output Parser (`ChatReply` schema), and three HTTP Request Tools posting to `http://host.docker.internal:8000/internal/n8n/tools/<name>` with Header Auth `n8n shared secret`; body `run_id` = `={{ $('Webhook').first().json.body.run_id }}`, model-filled arguments with `$fromAI(...)` named and described as in `app/agents/tools.py`; tool output field `result`. Respond to Webhook with `={{ $json.output }}`.
  - Credentials appear only as references (name, no id, no values).
- [ ] **Step 2: Check the files**: each parses as JSON (`python -m json.tool`); if the network allows, each imports into a scratch n8n (`N8N_USER_FOLDER=<scratch dir> npx --yes n8n@2.1.4 import:workflow --input=<file>`), otherwise the task report says it could not be run; if the import rejects ids like `vna-analyze`, use fixed 16-character alphanumeric ids and name them in the report; `grep -ri "key\|secret" n8n/workflows` shows only credential names and the header name; the app name from `config/app.json` appears nowhere.
- [ ] **Step 3: Write `n8n/compose.yaml`** (service and container `n8n`, image `n8nio/n8n:2.1.4`, ports `127.0.0.1:5678:5678`, volume `n8n_data:/home/node/.n8n`, a header comment: do not run beside an existing `n8n` container) **and `n8n/import.ps1`** (copies `n8n/workflows/*.json` into the container and runs `n8n import:workflow --input=<file>` for each).
- [ ] **Step 4: Write the setup doc section** "n8n mode": what it is (one paragraph, builtin is the default); the `n8n shared secret` Header Auth credential uses header name `X-N8N-Secret` and a value equal to `N8N_SHARED_SECRET` in `backend/.env`; the order from spec §5 (start n8n, create the `Gemini` and `n8n shared secret` credentials, run `import.ps1`, select credentials if needed, activate, set `AI_BACKEND=n8n`, `N8N_SHARED_SECRET`, `DATA_DIR`, `MODEL_CACHE_DIR`, `RETRIEVAL_MAX_DISTANCE`); after UI edits, export back to `n8n/workflows/` and commit; one `Invoke-RestMethod` example per webhook (with the `X-N8N-Secret` header) to try each workflow directly; the manual check (spec §6).
- [ ] **Step 5: Commit** `feat(n8n): add workflow drafts, compose file and setup guide`

### After Task 3 (lead, on the laptop, not a task)
Import the workflows, create and select credentials, activate, fix and export back; run `app.rag.calibrate` for `RETRIEVAL_MAX_DISTANCE`; do the manual check in spec §6.

## Review fixes (PR #83)

Lead review of PR #83 (head b519982). Backend code, tests and CI are sound; builtin mode is unchanged in behaviour (452 tests, ruff, pyright, `export-openapi --check` all pass). The n8n workflows were never loaded into n8n (Task 3 Step 2's scratch import was not reported), and reading the n8n 2.1.3 node source (`@n8n/n8n-nodes-langchain@2.1.3`, the version n8n 2.1.4 ships) shows two of them cannot work as written.

### Task 4: Workflow and tool-argument fixes (blocks merge)
No dependency.

**Files:**
- Modify: `n8n/workflows/analyze.json`, `n8n/workflows/chat.json`, `backend/app/n8n/routes.py`
- Test: `backend/tests/n8n/test_n8n_routes.py`

Findings:
1. `analyze`: both Basic LLM Chain nodes (typeVersion 1.4) lack `"hasOutputParser": true`. In 1.4 the parameter defaults to `false`, and `getOptionalOutputParser` only reads the parser when it is `true` (`utils/output_parsers/N8nOutputParser.js`). So each chain returns `{text}`, `$json.output` is empty, and every recording ends `analysis_failed` in n8n mode.
2. `chat`: the three tools use `@n8n/n8n-nodes-langchain.toolHttpRequest` 1.1, which is hidden ("Replaced by a `usableAsTool` version of the standalone HttpRequest node") and takes `{placeholder}` definitions, not `$fromAI`. The `$fromAI(...)` body values are not tool parameters for that node.
3. Even with a node that supports `$fromAI`, every call is untyped (`$fromAI('k')` is a string) and has no description (the descriptions are commented out inside the expressions). The routes then reject the values. Checked on b519982:
   - `SummarizeIn(sources="P1")` → "Input should be a valid list".
   - `FindRecordingsIn(tags="")` → "Input should be a valid list".
   - `SearchTranscriptsIn(k="")` → "unable to parse string as an integer".
   - `FindRecordingsIn(date_to="")` is accepted as `""`, and `find_recordings`' SQL `substr(created_at, 1, 10) <= ''` then matches nothing.

Steps:
- [ ] **Step 1: Write failing route tests**:
  - `""` for any optional field is treated as absent;
  - `tags` and `sources` given as a comma-separated string or a JSON-array string become lists;
  - `k` given as `""` or omitted becomes 8, and `"5"` becomes 5;
  - `date_to=""` returns the same recordings as no `date_to`.
- [ ] **Step 2: Implement the tolerance** in the body models of `app/n8n/routes.py` only (pydantic `field_validator(mode="before")`). The tools in `app/agents/tools.py` stay untouched.
- [ ] **Step 3: Fix `analyze.json`.** Set `"hasOutputParser": true` on both chains.
- [ ] **Step 4: Fix `chat.json`.** Replace the three tools with `n8n-nodes-base.httpRequestTool` (the HTTP Request node used as a tool, typeVersion 4.2). Keep the same URL, method and Header Auth credential, and send the body as JSON:
  - `run_id` from `$('Webhook').first().json.body.run_id`;
  - each model-filled argument as `$fromAI(name, description, type, default)`, with descriptions taken from `app/agents/tools.py`;
  - types: `string` for `query`, `text`, `date_from`, `date_to` and `focus`; `number` for `k`, default 8; `json` for `tags` and `sources`.
  - Give each tool node the description of its LangGraph tool.
- [ ] **Step 5: Check the workflows in n8n 2.1.4.** Import the three files into a scratch n8n: `N8N_USER_FOLDER=<scratch> npx --yes n8n@2.1.4 import:workflow --input=<file>`. If that can't run here, say so in the task report. Either way, list in the report the laptop checks the lead must run: the three `Invoke-RestMethod` calls from `docs/setup.md`, and one Chat question that triggers a transcript search.
- [ ] **Step 6: Run** `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .` and `uv run pyright`, and confirm they pass.
- [ ] **Step 7: Update the PR #83 description.** Its "Not done, or done differently" section must state what this review found, and whether the scratch import ran.
- [ ] **Step 8: Commit** with the message `fix(n8n): output parsers, typed tool arguments and tolerant callback bodies`.

### Task 5: Small fixes (does not block merge)
No dependency; may run with Task 4.

**Files:**
- Modify: `n8n/import.ps1`, `docs/setup.md`, `backend/app/container.py`

- [ ] **Step 1: Fix `import.ps1`.** Check `$LASTEXITCODE` after every `docker` call, and stop with an error naming the file. Today it prints "All workflows imported successfully." even when an import fails.
- [ ] **Step 2: Fix the export instructions in `docs/setup.md`.** `export:workflow --all --output=/tmp/workflows.json` writes one bundle inside the container. Replace it with one command per workflow, `docker exec n8n n8n export:workflow --id=<id> --output=/tmp/<name>.json`, followed by `docker cp n8n:/tmp/<name>.json n8n/workflows/<name>.json`.
- [ ] **Step 3: Restore `container.py`'s builtin lines.** Put the `if settings.ai_backend == "n8n":` block first, ending in `return container`, and leave the original builtin lines after it, byte-identical to `main`. The diff of `container.py` against `main` must then show only added lines (plus the `TYPE_CHECKING` import and the `n8n` field).
- [ ] **Step 4: Run** `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .` and `uv run pyright`, and confirm they pass.
- [ ] **Step 5: Commit** with the message `fix(n8n): import script exit codes, export guide, untouched builtin wiring`.
