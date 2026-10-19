# Chat Agent Tweaks Implementation Plan

> **For agentic workers:** implement this plan task by task as described in `docs/implementing-plan-tasks.md` (fresh implementer, fresh reviewer, fix loop per task); follow `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** approved. Branch `plan/stage-2-chat-agent`. Standalone plan (no stage-2 overview).

**Goal:** The Chat agent rewords and retries its searches, gets more iterations, and writes its own non-answer replies, in builtin and n8n mode.

**Architecture:** Prompt, tool-text, limit and citation-check changes in the existing agent code; the n8n `chat` workflow picks up the new reply type and iteration count. No API, mobile, embedder or config change.

**Tech Stack:** LangChain 1.4 / LangGraph 1.2 middleware, pydantic, pytest, n8n 2.1.4 workflow JSON.

**Spec:** `docs/superpowers/specs/2026-10-19-chat-agent-tweaks-design.md` (all of it).

## Global Constraints
- `openapi.json`, `backend/app/api/models/chats.py`, `FinalReply`'s reply types and everything under `mobile/` stay unchanged; `uv run python -m app.cli export-openapi --check` stays clean.
- No embedder, `config/models.yaml` or `chat_deadline_s` change.
- Fixed texts `NOT_FOUND`, `COULD_NOT_FINISH`, `GREETING`, `HELP`, `OUT_OF_SCOPE` in `backend/app/agents/citations.py` keep their wording; they become fallbacks.
- The search tool's no-hit text is exactly `<sources>\n</sources>\nNo passages matched. Try broader or related terms.`

## Review Focus
1. The model puts `[P1]` in a `not_found` or greeting reply → the label is removed, no citation is stored. (Task 1 test.)
2. The model returns `not_found` with empty or null text → "Not in your recordings.". (Task 1 test.)
3. An `answer` with only invented labels → still "Not in your recordings.", never the model's ungrounded text. (Task 1 test.)
4. n8n returns `not_found` → stored as `answer` with no citations; the app shows it as plain text. (Task 1 test.)
5. Overlap: the UI polish plan (#87) renders the backend `HELP` text as markdown in the app; model-written help replies must stay valid plain text / simple lists for it.
6. A question needing several searches still ends inside the 75 s deadline in normal conditions (manual check).

---

### Task 1: Rewording, iteration limits and model-written replies
No dependency.

**Files:**
- Modify: `backend/app/agents/schemas.py` (`ChatReply.reply_type`), `backend/app/agents/citations.py` (`check_citations`), `backend/app/agents/chat_graph.py` (three limits), `backend/app/agents/tools.py` (no-hit text in `search_transcripts` only), `backend/app/agents/prompts/orchestrator.md`, `n8n/workflows/chat.json` (parser enum, `maxIterations`)
- Test: `backend/tests/agents/test_citations.py`, `backend/tests/agents/test_chat_graph.py`, `backend/tests/agents/test_tools.py`, `backend/tests/n8n/test_n8n_chat_graph.py`

**Interfaces:**
- Produces: `ChatReply.reply_type: Literal["answer", "not_found", "greeting", "help", "out_of_scope"]`; `check_citations(reply, registry) -> FinalReply` with the rules of spec §3 (`FinalReply.reply_type` stays `Literal["answer", "greeting", "help", "out_of_scope"]`).

- [ ] **Step 1: Write failing citation tests**
  - `greeting`, `help`, `out_of_scope` with text `"Hey there!"` → that text, same reply type, no citations.
  - `not_found` with text `"I looked for war, conflict and military but found nothing."` → `FinalReply("answer", <that text>, [])`.
  - Labels removed: `not_found` text `"Nothing on that [P1], sorry [R2]."` with P1 registered → `"Nothing on that, sorry."`, no citations.
  - Fallbacks: empty, whitespace-only or `None` text → `NOT_FOUND` for `not_found` (as `answer`), `GREETING`, `HELP`, `OUT_OF_SCOPE` respectively.
  - Unchanged: `answer` with only unknown labels → `NOT_FOUND`; `None` reply → `COULD_NOT_FINISH`. Update existing tests that asserted the fixed texts for non-empty model text.
- [ ] **Step 2: Write failing limit and tool tests**
  - Chat graph (with the existing fake models in `tests/agents/fake_models.py`): tools are removed on the 9th model turn, not the 6th; the run ends at 10 model calls; the 8th tool call is refused, the 7th runs. Update the existing limit tests (e.g. `test_final_answer_forced_on_sixth_turn` and any test built on 6/7/4); their failures are expected, not regressions.
  - `search_transcripts` with no hit → exactly the no-hit text from Global Constraints. Update any existing assertion on the bare empty `<sources>` block for this tool (`find_recordings` keeps its own).
  - n8n (`test_n8n_chat_graph.py`): the `chat` webhook answers `{"reply_type": "not_found", "text": "Nothing about war."}` → stored message has `reply_type` `answer`, that text, no citations.
- [ ] **Step 3: Run** `uv run pytest tests/agents tests/n8n -v` and confirm the new tests FAIL.
- [ ] **Step 4: Implement** the schema, `check_citations` (strip labels with the existing label regex, tidy whitespace as for answers), the three limits in `build_chat_graph` (`from_turn=9`, `run_limit=10`, `run_limit=7`) and the no-hit text.
- [ ] **Step 5: Rewrite `orchestrator.md`** per spec §1 and §3:
  - rewording and retry rules, with the "war" example;
  - every reply type writes `text`;
  - `not_found` names the terms tried and may offer a nearby topic the tools returned, with no facts and no labels;
  - greeting, help and out-of-scope guidance based on the current fixed texts;
  - never send an `answer` without citation labels: if nothing can be cited, use `not_found` (otherwise the fixed "Not in your recordings." comes back);
  - a nearby-topic offer in `not_found` may only name a recording title or topic a tool returned in this run;
  - non-answer replies are short plain sentences; a simple `-` list is fine (the UI polish plan's markdown task renders the help reply as a list), no headings or bold;
  - keep the existing untrusted-`<sources>` and citation rules word for word.
- [ ] **Step 6: Update `n8n/workflows/chat.json`**: add `not_found` to the Structured Output Parser's `reply_type` enum, set the AI Agent's `maxIterations` to 10, and change nothing else. Check it parses (`python -m json.tool`).
- [ ] **Step 7: Run** `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright` and `uv run python -m app.cli export-openapi --check`, and confirm all pass.
- [ ] **Step 8: Commit** with the message `feat(backend): reworded searches, more iterations and model-written chat replies`

### After Task 1 (lead, on the laptop, not a task)
Re-import `n8n/workflows/chat.json` (`.\n8n\import.ps1`), reselect credentials if asked, activate. Then the manual checks in spec §4, in both modes.
