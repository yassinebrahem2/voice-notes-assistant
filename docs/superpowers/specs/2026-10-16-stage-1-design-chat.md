# Stage 1 design: models, agents and Chat

Part of the stage 1 spec (overview: `2026-10-16-stage-1-design.md`). Approved in sections 2–5 of the brainstorming. Library facts below were checked in the code of langchain 1.4.6, langgraph 1.2.15 and langgraph-prebuilt 1.1.1.

## 1. Model registry and agent factory
- `config/models.yaml` is the registry: providers (`base_url`, `key_env`) and, per role, an ordered and configurable failover list. LLM roles: `llm` (Chat: Orchestrator and the Chat merge) and `llm_analysis` (processing Summarizer). Each LLM entry: provider, model id, reasoning setting (low effort / small thinking budget), `max_request_tokens`, `timeout_s`. Code asks for a role, never a model.
- One agent factory (`app.llm`) builds every agent and chat model from the registry, so failover, retry, timeouts and reasoning settings are written once. No rate-limit modelling or quota counting: a failing model, a 429 included, hands over to the next in its role's list.
- Chat models: `ChatOpenAI` against each provider's OpenAI-compatible endpoint (`langchain-openai`, version confirmed in the first backend task).
- `llm` role middleware stack (first = outermost):
  1. `ModelFallbackMiddleware(*rest_of_list)`: verified to call `handler(request.override(model=fallback))` on an exception, and tools and structured output are bound per request inside the handler, so each fallback model gets them re-bound. This answers the roadmap's `with_fallbacks` / `bind_tools` question.
  2. `ModelRetryMiddleware(max_retries=1, retry_on=<predicate>, on_failure="error")`: the predicate retries 5xx, timeouts and connection errors, never 429 or 400 (a Groq 400 for a malformed tool call goes straight to the next model). `on_failure="error"` is required: the default `"continue"` turns an exhausted retry into a normal message and the fallback would never trigger.
  3. Final-answer middleware (ours, `wrap_model_call`): counts model calls in the run; on the last allowed call (6) it overrides the request so that only the `ChatReply` structured-output tool remains, forcing the model to answer from what it has gathered.
  4. `ModelCallLimitMiddleware(run_limit=7, exit_behavior="end")`: a safety net behind the final-answer middleware, normally never reached; if reached the run fails with `ai_unavailable`.
  5. `ToolCallLimitMiddleware(run_limit=4)` (default `exit_behavior="continue"`): further tool calls are refused with a message and the model answers with what it has.
- Structured output is always `ToolStrategy(schema)`, never a raw schema: a raw schema becomes `AutoStrategy`, which may pick native JSON-schema output with `strict=True` that an OpenAI-compatible endpoint can reject, and that would only surface on fallback.
- `llm_analysis` does not use the fallback middleware; the processing workflow walks its list (processing file §4).
- The first backend agent task smoke-tests the same agent, tools and `ToolStrategy` against Groq and Gemini (manual, needs keys, not in CI).

## 2. Orchestrator agent
`create_agent(name="orchestrator", tools=[…], response_format=ToolStrategy(ChatReply), context_schema=ChatContext, middleware=[…])`.

Run context (`ChatContext`, set by the server, never tool arguments): scope (`notes` | `meetings` | `both`), tag filter, today's date, and a per-run `SourceRegistry`. Tools read it through `ToolRuntime` (`from langchain.tools import ToolRuntime`: `runtime.context`, `runtime.stream_writer`). `dynamic_prompt` middleware adds today's date and the scope to the system prompt.

Input: the question plus the last 6 turns of the chat. History renders past citations as plain text, e.g. "(Budget sync, 12:04)", never as labels.

Tools (all see only `ready` recordings and apply scope and tag filter from the context; asked about a recording still processing, they say it is not ready yet):
- `search_transcripts(query: str, k: int = 8)`: retrieval (§5). Returns passages labelled `[P1]…`, each with recording title, date, speaker names (current names, e.g. "Sarah (Speaker A)"), timestamp and text, wrapped in `<sources>`. A passage is one chunk; its citation target is the chunk's first segment.
- `find_recordings(text?: str, date_from?: str, date_to?: str, tags?: list[str])`: metadata lookup, returns recordings labelled `[R1]…` (title, date, duration, tags, one-line overview). Citation target: the recording's first segment, `start_ms` 0.
- `summarize(sources: list[str], focus?: str)`: takes labels (`"R2"`, or `"P4"` meaning its recording), never IDs. One meeting → its stored summary (no model call); one note → its stored key points; several → one merge call to the Summarizer (role `llm`) over the stored, rendered summaries, output `ChatSummary {overview, decisions, action_items, open_questions}` citing the `[P n]` labels of the items it was given. Stored items are registered as passages so the Orchestrator can cite them.
- Each tool writes a status line through `runtime.stream_writer`: "Searching meetings…", "Found 6 passages", "Looking up recordings…", "Summarizing 2 meetings…". The graph adds "Writing answer…".

`SourceRegistry` numbers labels under a lock (tool calls may run in parallel). Labels exist only inside the run that created them.

## 3. Output and prompts
```python
class ChatReply(BaseModel):
    reply_type: Literal["answer", "greeting", "help", "out_of_scope"]
    text: str | None   # only for "answer"; cites with [P n] / [R n]
```
- Only `answer` carries model text. `greeting`, `help` (lists the starter questions) and `out_of_scope` show fixed server text, so the model never writes ungrounded free text and never copies IDs.
- Prompt core: answer only from `<sources>`; every sentence with a fact ends with its labels; if the sources do not contain the answer, say what is missing; never invent names, dates or numbers; use the non-answer reply types for greetings, how-to-use questions and off-topic questions; tool descriptions say when to use each tool. Shared prompt rules: processing file §3.

## 4. Chat graph and citation check
```
START → orchestrator ⇄ tools (search_transcripts, find_recordings, summarize → Summarizer)
      → check_citations (code) → END
```
`check_citations`:
- maps each `[P n]` / `[R n]` to `{recording_id, segment_id, start_ms}` (plus recording title for display) and drops unknown labels;
- `answer` with no valid citation left → the fixed reply "Not in your recordings.";
- retrieval found nothing within the relevance cut-off and the answer cites nothing → "Not in your recordings.";
- stores the assistant message with resolved citations, never labels.

## 5. Retrieval
- The query is embedded through the embedder wrapper (with BGE's query instruction).
- Exact, filtered search in one SQL query: `chunks` joined to recordings and tags (scope, tag filter, `status = 'ready'`), ordered by sqlite-vec's `vec_distance_cosine(embedding, :q)`, `LIMIT k`. Joins express the many-to-many tag filter, which a `vec0` KNN table cannot; exact search over a personal corpus is fast.
- Overlapping or adjacent chunks of the same recording are merged before labelling.
- Relevance cut-off: setting `max_distance` (cosine distance, 0 = identical). The default is permissive and marked provisional; a plan task calibrates it on the demo recordings with questions that have known answers and unrelated questions.
- No keyword search and no re-ranking (known limit).

## 6. Chat runs and failures
- `POST …/messages` stores the user message and starts the run as a background task: `ainvoke` under `asyncio.wait_for` with a 75 s deadline (setting), so cancellation really stops it. Steps are kept in memory per run.
- Run states: `running` → `done` (assistant message stored) | `failed` with:
  - `ai_unavailable`: every model in `llm` failed, output stayed invalid after validation re-asks, or the safety-net call limit was reached → "Couldn't reach the AI right now.";
  - `timed_out`: the deadline passed → "That took too long.".
- There is no "too many steps" failure: the final-answer middleware always forces an answer on the last allowed call.
- Retry re-runs the stored user message (it is not stored twice) under the same run id, replacing the failed run.
- Server restart: runs live in memory, so polling returns 404 and the app shows "Interrupted" + Retry.
- "Not in your recordings." is a normal reply, not an error.
