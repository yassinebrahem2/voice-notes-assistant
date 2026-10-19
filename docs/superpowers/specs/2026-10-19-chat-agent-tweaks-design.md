# Chat agent tweaks design

Changes to the Chat agent of the stage 1 chat spec (`2026-10-16-stage-1-design-chat.md` §1–§4). They apply to both builtin and n8n mode: n8n mode gets the same orchestrator prompt from the backend, calls the same Python tools and goes through the same citation check. Approved by the lead in chat on 2026-10-19. Embedders do not change (builtin keeps bge-small, n8n keeps Gemini).

## 1. Active searching and rewording
- Orchestrator prompt (`backend/app/agents/prompts/orchestrator.md`):
  - Before searching, turn a short or vague question into a fuller search phrase (e.g. "war" → "war, conflict, military, fighting").
  - When a search returns no passages or only weak ones, search again with 2–3 related terms or a broader phrase before concluding that nothing is there.
  - A `not_found` reply says what was searched for (the terms tried), so the user sees the search happened.
- `search_transcripts` with no hit inside the cut-off returns
  `<sources>\n</sources>\nNo passages matched. Try broader or related terms.`
  instead of the bare empty `<sources>` block. Its non-empty result is unchanged.

## 2. More iterations

| Limit | Old | New |
|---|---|---|
| Builtin: `ForceOutputToolMiddleware(from_turn=…)` | 6 | 9 |
| Builtin: `ModelCallLimitMiddleware(run_limit=…)` | 7 | 10 |
| Builtin: `ToolCallLimitMiddleware(run_limit=…)` | 4 | 7 |
| n8n: AI Agent `maxIterations` (`n8n/workflows/chat.json`) | 6 | 10 |

`chat_deadline_s` stays 75 (the app gives up at 90 s).

## 3. Model-written replies
Replaces chat spec §3's "Only `answer` carries model text" and the "Not in your recordings." rules of §4.

```python
class ChatReply(BaseModel):
    reply_type: Literal["answer", "not_found", "greeting", "help", "out_of_scope"]
    text: str | None
```
- The model writes `text` for every reply type. The prompt keeps today's fixed texts as guidance for `greeting`, `help` (mention the kinds of questions the user can ask) and `out_of_scope`. `not_found` is for "searched, found nothing that answers it": a short friendly reply naming the terms tried and, when the tools returned something nearby, offering it as a next question. These replies state no facts from the recordings.
- `check_citations`:
  - `answer`: unchanged (labels resolved, unknown labels dropped, no valid citation left → "Not in your recordings.").
  - `not_found`, `greeting`, `help`, `out_of_scope`: every `[P n]`/`[R n]` label is removed from the text, and whitespace is tidied as for answers. If the text is then empty or missing, the current fixed text is used (`NOT_FOUND`, `GREETING`, `HELP`, `OUT_OF_SCOPE`). No citations.
  - `not_found` is stored and returned as `reply_type="answer"` with no citations, so the API (`openapi.json`), `FinalReply`, `MessageOut` and the mobile app do not change. The other three keep their own reply types.
  - No `ChatReply` at all → "I couldn't finish answering that. Try asking it another way." (unchanged).
- n8n `chat.json` Structured Output Parser: `reply_type` enum gains `not_found`.

## 4. Testing
- Citation check: model text kept for the four non-answer types; labels stripped; empty text falls back to each fixed text; `not_found` comes out as `answer` with no citations; `answer` rules unchanged.
- Chat graph: the three new limits (forced answer on turn 9, run ends at 10 model calls, 8th tool call refused).
- `search_transcripts`: the no-hit text.
- n8n: a `not_found` reply from the `chat` webhook comes out as `answer` with the model's text and no citations.
- Manual, both modes: ask about a topic present only under related words ("war") and see a second search with related terms; ask about something absent and get a model-written `not_found`; say hi.
