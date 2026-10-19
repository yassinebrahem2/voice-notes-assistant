# n8n mode design

A course requirement asks for n8n in the AI pipelines and Chat. Our app stays exactly as it is: the builtin code, its behaviour, its config and its contracts do not change. n8n mode is an add-on for the demo, switched on by one setting, built from n8n's own nodes with Gemini only.

## 1. Rule: builtin is untouched
- No existing module is refactored, moved or changed in behaviour. n8n mode only adds files, plus a switch in two places (§3), each a branch that builtin mode never enters.
- Existing code is reused by import, never edited: `render_transcript`, `load_prompt`, `history_for`, `check_citations_node`, `ChatState`, the LangGraph tools, the pydantic schemas, `store_analysis`, `index_recording`.
- `config/models.yaml`, `docs/roadmap.md`, the public API (`openapi.json`) and the mobile app do not change. All existing tests stay green unchanged.
- n8n mode does not get builtin's failover, map-reduce, call limits or Chat progress steps.

## 2. What n8n does
Three workflows, committed as JSON in `n8n/workflows/`. Each starts with a Webhook node (POST, path exactly `analyze`, `embed` or `chat`; Header Auth credential checking `X-N8N-Secret`; respond "using Respond to Webhook node") and ends with Respond to Webhook returning `{{ $json.output }}` for the two LLM workflows (chains and agents with an output parser put their result under `output`). The backend sends prompts and model ids in each call; workflows read them with expressions.

### `analyze` (title, tags, summary or clean note)
```
Webhook ─► Switch (kind) ─┬─ meeting ─► Basic LLM Chain ─┐
                          └─ note ────► Basic LLM Chain ─┴─► Respond to Webhook
             each chain: Google Gemini Chat Model (model = {{ $json.body.model }})
                         + Structured Output Parser (that kind's schema, $defs inlined)
```
In: `{kind, model, system_prompt, user_content}`, built exactly as `SummarizerAnalyzer` builds its single call. Out: `MeetingAnalysis` or `NoteAnalysis`.

### `embed` (text to vectors)
```
Webhook ─► HTTP Request (Gemini batchEmbedContents, Gemini credential) ─► Respond to Webhook
```
In: `{model, texts, task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"}`. Each text becomes `{model: "models/<id>", content: {parts: [{text}]}, taskType, outputDimensionality: 768}` in `requests[]`; the reply's `embeddings[].values` come back as `{vectors}`, same order. (n8n's Embeddings Gemini node only feeds n8n vector stores and cannot return vectors.)

### `chat` (answer with citations)
```
Webhook ─► AI Agent ─► Respond to Webhook
             ├ Google Gemini Chat Model   (model = {{ $json.body.model }})
             ├ Structured Output Parser  (ChatReply)
             ├ HTTP Request Tool: search_transcripts ─► backend
             ├ HTTP Request Tool: find_recordings    ─► backend
             └ HTTP Request Tool: summarize          ─► backend
```
In: `{model, run_id, system_prompt, prompt}`: the orchestrator prompt plus today's date and scope, and one text rendering `state["messages"]` (the last 6 turns and the question, already loaded by `ChatRuns`) as `User: …` / `Assistant: …` lines. No n8n memory node. Agent max iterations 6. Arguments the model fills use `$fromAI(...)`. Each tool posts `{run_id, ...arguments}` to `http://host.docker.internal:8000/internal/n8n/tools/<name>` with the Header Auth credential; `run_id` comes by expression from the Webhook body, never from the model. Out: `ChatReply`.

## 3. Backend additions
All new code lives in `app/n8n/`.

| File | What |
|---|---|
| `settings.py` | `N8nSettings` (own pydantic-settings class, read only in n8n mode): `n8n_url` (default `http://127.0.0.1:5678`), `n8n_timeout_s` (60), `n8n_embed_model` (`gemini-embedding-001`). `N8N_SHARED_SECRET` read as `SecretStr` like `hf_token()`. |
| `client.py` | Sync `post` and async `apost` to `{n8n_url}/webhook/<name>` with the secret. Connection errors, timeouts, 5xx and 404 (workflow not active, logged so) raise `N8nUnavailable(ModelError)`, so `ChatRuns` already reports it as "AI unavailable"; 4xx or a body failing validation raise `N8nBadResponse`. A top-level `output` is unwrapped if present. |
| `analyzer.py` | `N8nAnalyzer(SummarizerAnalyzer)`: overrides `analyze` only, building the same `system_prompt`/`user_content` with the inherited helpers, sending the first `llm_analysis` entry whose provider has `client: google_genai`, validating by `kind`, one retry on `N8nBadResponse`. |
| `embedder.py` | `N8nEmbedder` (`Embedder`, `dim = 768`), at most 100 texts per call. |
| `chat_graph.py` | `build_n8n_chat_graph(container)`: a LangGraph graph `n8n_agent → check_citations` using our existing `ChatState` and `check_citations_node`. The `n8n_agent` node registers `runtime.context` under a new `run_id`, writes one step ("Asking n8n…") through `runtime.stream_writer`, calls the `chat` webhook with `apost` (no per-call timeout: the chat deadline governs), returns `{"structured_response": reply}`, and unregisters in `finally`. `ChatRuns` takes it as its graph factory, so `ChatRuns` itself does not change. |
| `routes.py` | `POST /internal/n8n/tools/{search_transcripts,find_recordings,summarize}`, secret checked with `hmac.compare_digest` (401), unknown `run_id` 404. They call the existing LangGraph tools' own functions (`.func` / `.coroutine`) with a `ToolRuntime` built from the registered context (`state={}`, `config={}`, `tool_call_id="n8n"`, `store=None`, `tools=[]`) and a no-op step writer. `search_transcripts` and `find_recordings` are sync handlers, `summarize` async. Not in `openapi.json`. |

The switch, the only edits to existing files. Builtin mode imports nothing from `app/n8n`: every `app.n8n` import sits inside the n8n branch (as `build_chat_graph` is already imported lazily), which also avoids a circular import through `app.container`.
- `app/config/settings.py`: one field, `ai_backend: Literal["builtin", "n8n"] = "builtin"`.
- `app/container.py`: `if settings.ai_backend == "n8n":` use `N8nAnalyzer`, `N8nEmbedder` and `build_n8n_chat_graph`; refuse to start without `N8N_SHARED_SECRET` or a `google_genai` entry in `llm`/`llm_analysis`. The `else` is today's code, unchanged.
- `app/api/app.py`: include the `app/n8n/routes.py` router only in n8n mode.
- `backend/.env.example`: the new variables, commented out.

Multi-recording `summarize` makes one LLM call through the Python `llm` role, as the tool does today; in n8n mode that call stays in Python.

## 4. Data
- Gemini vectors (768) and fastembed vectors (384) do not mix. n8n mode runs with its own `DATA_DIR`, and `MODEL_CACHE_DIR` set to the existing cache (it otherwise follows `DATA_DIR` and the speech models would download again). Demo recordings are re-uploaded there so n8n does the analysis.
- `RETRIEVAL_MAX_DISTANCE` is set in `.env` for n8n mode after running `app.rag.calibrate` once the workflows work.

## 5. Running n8n
- The lead's existing Docker container `n8n` (n8nio/n8n 2.1.4) is used. `n8n/compose.yaml` documents the same setup for other machines (image `n8nio/n8n:2.1.4`, port `127.0.0.1:5678:5678`, volume `n8n_data`) and must not run beside it.
- n8n reaches the backend at `http://host.docker.internal:8000` (checked on the laptop on 2026-10-18).
- Credentials: Header Auth (the shared secret) and Google Gemini (the key), created in the n8n UI and kept in n8n's encrypted store in its volume, never in a workflow file. Two exceptions to the repo rules, n8n mode only: these secrets also live outside `.env`, and the embedding model id is the `n8n_embed_model` setting rather than an entry in `config/models.yaml` (which stays unchanged).
- Authorship: an implementer drafts the three workflow files from §2; the lead imports them (`docker exec n8n n8n import:workflow --input=…`), selects the credentials, activates them, fixes what fails, and exports them back to `n8n/workflows/`.
- Order: start n8n → create credentials → import → select credentials → activate → set `AI_BACKEND=n8n`, `N8N_SHARED_SECRET`, `DATA_DIR`, `MODEL_CACHE_DIR`, `RETRIEVAL_MAX_DISTANCE` in `backend/.env`. The setup doc gets this as an "n8n mode" section.

## 6. Testing
- All existing tests pass unchanged, which shows builtin is untouched.
- New tests under `tests/n8n/`, HTTP mocked with httpx `MockTransport` (CI never runs n8n): client error mapping; `N8nAnalyzer` sends what `SummarizerAnalyzer` would and validates by `kind`; `N8nEmbedder` batching and order; the n8n chat graph produces a `FinalReply` through the real citation check; callback routes (401, 404, a live run's search labels resolved by the check); `build_container` picks each implementation by `ai_backend` and refuses n8n mode without the secret.
- Manual, on the laptop: in n8n mode, process the longest demo recording and a note, see them reach `ready`, ask Chat a question that searches transcripts, open a citation.
