# Stage 1 Mobile Chat and Settings Implementation Plan

> **For agentic workers:** implement this plan task by task as described in `docs/implementing-plan-tasks.md` (fresh implementer, fresh reviewer, fix loop per task); follow `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** approved. Branch `plan/stage-1-mobile-chat-settings`, plan issue #20.

**Goal:** The Chat tab (scope and tags, starters, live agent steps, answers with citation chips, fixed replies, retry), Settings (server URL with Test connection, theme, readiness), and the app-wide server banner and status dot.

**Architecture:** Screens in `mobile/app/(tabs)/chat.tsx` and `settings.tsx`; logic in `mobile/src/chat/` and `mobile/src/settings/`; the server status hook in `mobile/src/server/`. The Chat run is a small state machine driven by polling `GET /chats/{id}/runs/{run_id}`; it is unit-tested with fake timers.

**Tech Stack:** Expo SDK 58, expo-router, React Native Paper 5, TanStack Query 5, AsyncStorage, jest-expo, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-ui.md` (§3 Chat, Settings, Everywhere; §6), `…-design-chat.md` §6 (run states), `…-design-data-api.md` (§4 chats routes, `/health`; §5 errors).

**Stage overview:** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. **Builds on:** the foundation mobile code (`apiFetch`, `ApiError`, `errorMessage` and `openFanOut` (foundation Task 9), `Schemas`, `queryClient`, `normalizeServerUrl`/`getServerUrl`/`setServerUrl`/`useServerUrl`, theme, `TabBar`, `appInfo`). Uses the agents plan's chat endpoints; until they land, the stub routes answer 501 and Chat shows its error state.

## Global Constraints (this plan)
- Everything in the overview's Global constraints and the mobile recording plan's (tokens only, 48 dp targets, reduce motion, `npx expo install`).
- Citation chips only navigate to `/recording/<id>?segment=<seg_id>`; the recording page belongs to the mobile recording plan.
- Answers render the server's text; the app never invents or rewrites answer text.

## Review Focus
1. The server restarts mid-question → "Interrupted" + Retry, which asks the same question once. (Task 1 test.)
2. A run that never finishes → the app stops polling at 90 s with "Taking too long" + Retry. (Task 1 test.)
3. A server URL typed with `http://` or a trailing slash → saved normalised; Test connection says "Not HTTPS". (Task 3 test.)
4. The laptop goes offline → banner within 10 s, gone by itself once reachable; lists keep their data. (Task 4 test.)
5. Switching tabs mid-run → coming back shows the same run continuing. (Task 1 test.)

---

### Task 1: Chat client state and run polling

**Files:**
- Create: `mobile/src/chat/api.ts`, `mobile/src/chat/runMachine.ts`, `mobile/src/chat/useChatSession.ts`
- Test: `mobile/src/chat/runMachine.test.ts`, `mobile/src/chat/useChatSession.test.ts`

**Interfaces:**
- Produces:
  - `api.ts`: `createChat()`, `ask(chatId, { text, scope, tag_ids })`, `getRun(chatId, runId)`, `retryRun(chatId, runId)`, `getChat(chatId)` (typed with `Schemas`).
  - `runMachine.ts`: `RunView = { phase: "sending" | "running" | "done" | "failed" | "interrupted" | "too_slow"; steps: string[]; message?: MessageOut; error?: string }`; `nextRunView(prev: RunView, event: { poll: RunOut } | { pollError: ApiError } | { elapsedMs: number }): RunView` (404 → `interrupted`; `failed` → message from `errorMessage`; elapsed ≥ 90 000 → `too_slow`; network errors keep polling until 90 s).
  - `useChatSession()`: module-level store (survives tab switches while the app is open): `{ chatId, turns: { question, run: RunView }[], scope, tagIds, ask(text), retry(index), newChat(), setScope, setTagIds }`; polls every 500 ms while the latest run is `sending`/`running`; the chat is created lazily on the first question; `retry` calls `retryRun` (same run id; the question is not resent). Decision #48, a turn with no run id (the create-chat or `POST …/messages` call failed with `network_error`, `timeout` or a 5xx, so the server may or may not have stored the question: the backend stores the message before it starts the run): with no chat id, ask again (nothing reached the server). With a chat id, first `getChat(chatId)` and look for a user message with the same text whose id is not already a run id of another turn in this session: found → adopt its id as the run id and resume polling (a 404 then means interrupted, and Retry calls `retryRun`, which re-runs a stored question); not found → ask again (the question was never stored). If `getChat` fails, the turn stays failed with Retry. Never send the question twice. A `retryRun` answered with 409 `not_failed` (the run is still going or already done, for example after `too_slow`) resumes polling that run instead of showing an error. Only a 4xx answer to the POST (422 `validation_error`, 404 `not_found`) means the question was not stored; every other failure goes through the `getChat` check above. A 404 for the chat itself (on the POST or on `getChat`) means the chat is gone: drop `chatId`, so Retry creates a new chat and asks there.
- [ ] **Step 1: Write the failing tests** (jest fake timers, mocked `apiFetch`):
  - `nextRunView` table: running with new steps; done with message; failed `ai_unavailable` → "Couldn't reach the AI right now."; 404 → interrupted; 90 s → too_slow.
  - `useChatSession`: ask → polls until done and stops; retry after interrupted calls `retryRun` once and resumes polling; retry after a timed-out or 5xx POST whose question the server stored (mocked `getChat` lists it) adopts that message id and polls it without a second `ask`; retry after a timed-out POST whose question is not stored calls `ask` once; retry with no chat id calls `createChat` and `ask`; retry after a 422 on the POST calls `ask` again without `getChat`; retry after a 404 for the chat creates a new chat and asks there; `retryRun` → 409 `not_failed` resumes polling; state survives unmount/remount of the consumer (tab switch); `newChat` clears turns and the next ask creates a new chat.
- [ ] **Step 2: Run** `npx jest src/chat` → FAIL. **Step 3: Implement.** **Step 4: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 5: Commit** `feat(mobile): add chat session state and run polling`.

### Task 2: Chat screen

**Files:**
- Create: `mobile/src/chat/ChatScreen.tsx`, `mobile/src/chat/ScopeBar.tsx`, `mobile/src/chat/Starters.tsx`, `mobile/src/chat/AnswerText.tsx`, `mobile/src/chat/citations.ts`, `mobile/src/chat/StatusLine.tsx`
- Modify: `mobile/app/(tabs)/chat.tsx` (render `<ChatScreen />`)
- Test: `mobile/src/chat/citations.test.ts`, `mobile/src/chat/ChatScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1; `useTags` query key `["tags"]` (same key as the mobile recording plan; this plan defines its own hook if that plan has not merged, then keeps one on rebase); `GET /recordings` to know whether any recording is ready.
- Produces:
  - `splitAnswer(text: string, citations: CitationOut[]): ({ text: string } | { citation: CitationOut })[]` (turns `[k]` markers into chip parts; unknown markers stay as text).
  - `citationLabel(c: CitationOut): string` → `"<recording title> · <mm:ss>"`.
  - Screen: scope selector (Notes / Meetings / Both, segmented) and tag chips at the top; empty chat → 3–4 starter questions (fixed list in the file); no ready recording yet → "Chat answers from your recordings. Record something first." with a Record button calling `openFanOut()` (UI spec §3); each turn shows the question, then the live `StatusLine` (last step, animated dots, reduce-motion safe), then the answer with citation chips (`router.push({ pathname: "/recording/[id]", params: { id, segment } })`; the `/recording/[id]` route comes from the mobile recording plan: until it exists, local `tsc` rejects this typed path, so run `npx expo start` once (it regenerates the typed routes in `.expo/types`) after that plan merges; CI is unaffected) or the fixed reply text; failed / interrupted / too slow → message + Retry; "New chat" in the header; input with send button (disabled while a run is going), keyboard-avoiding.
- [ ] **Step 1: Write the failing tests:** `splitAnswer` (markers in order, repeated marker, unknown marker kept as text); `citationLabel` formatting; screen: starters shown when empty; tapping a chip calls `router.push` with `{ pathname: "/recording/[id]", params: { id, segment } }`; Retry visible on interrupted.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** the input stays visible above the keyboard (Android edge-to-edge changes `KeyboardAvoidingView` behaviour).
- [ ] **Step 6: Commit** `feat(mobile): add the chat screen`.

### Task 3: Settings

**Files:**
- Create: `mobile/src/settings/SettingsScreen.tsx`, `mobile/src/settings/testConnection.ts`, `mobile/src/settings/themePreference.ts`
- Modify: `mobile/app/(tabs)/settings.tsx`, `mobile/app/_layout.tsx` (theme from the preference instead of the system scheme only)
- Test: `mobile/src/settings/testConnection.test.ts`, `mobile/src/settings/themePreference.test.ts`

**Interfaces:**
- Produces:
  - `testConnection(input: string): Promise<{ ok: true; health: HealthOut } | { ok: false; problem: "not_https" | "unreachable" | "not_this_server" }>`: normalises with `normalizeServerUrl`; `http://` → `not_https` without a request; `fetch(<typed URL>/api/v1/health)` directly with an `AbortController` 5 s timeout (not `apiFetch`, which uses the stored URL rather than the one being tested); network error or timeout → `unreachable`; a response that is not `HealthOut` or whose `app_name` differs from `appInfo.name` → `not_this_server`.
  - `ThemePreference = "system" | "light" | "dark"`; `getThemePreference()`, `setThemePreference()` (AsyncStorage `theme`), `useThemePreference()`; the root layout picks `paperTheme(preference === "system" ? colorScheme : preference)`.
  - Screen: server URL field with Save and Test connection (result shown inline: "Connected", "Not HTTPS", "Can't reach the server", "That isn't this app's server"); theme segmented control; readiness list from `/health` roles ("Speech: fake (dev)", "Chat AI: missing GROQ_API_KEY", …); app name and version from `appInfo`.
- [ ] **Step 1: Write the failing tests:** `testConnection` cases (http → not_https with no fetch; the request goes to the typed URL even when a different URL is stored; timeout → unreachable; wrong app name → not_this_server; good → ok); theme preference round-trip and default `system`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5: Commit** `feat(mobile): add settings with connection test and theme`.

### Task 4: Server status banner and tab dot

**Files:**
- Create: `mobile/src/server/statusStore.ts` (dependency-free: imports nothing from `src/api`), `mobile/src/server/useServerStatus.ts`, `mobile/src/server/ServerBanner.tsx`
- Modify: `mobile/app/_layout.tsx` (banner above the tabs), `mobile/src/components/TabBar.tsx` (status dot on Settings), `mobile/src/api/client.ts` (`apiFetch` reports to the status store)
- Test: `mobile/src/server/useServerStatus.test.ts`, `mobile/src/api/client.test.ts` (extend)

**Interfaces:**
- Produces:
  - `statusStore.ts`: `ServerStatus = "unknown" | "ok" | "unreachable" | "no_server"`; `reportNetworkError()`, `reportOk()`, `reportNoServer()`, `useServerStatusValue()` (module state + `useSyncExternalStore`, like the foundation's `fanOutStore`). It imports nothing, so `client.ts` can import it without a cycle.
  - `apiFetch` (in `client.ts`) calls `reportNetworkError()` on the first failure of the real request (its `network_error` or `timeout` from the catch around `fetch`), and `reportOk()` on any successful response. The earlier throws for a missing or unreadable server URL do not report a network error (they would turn `no_server` into `unreachable`). Reporting from `QueryCache`/`MutationCache` `onError` would be too late: it fires only after the last retry (≥ 30 s with `retry: 2` and the 10 s timeout).
  - `useServerStatus()`: while `unreachable`, `GET /health` every 10 s (through `apiFetch`, which reports `ok` on success); no stored server URL → `no_server` without polling.
  - `ServerBanner`: "Can't reach the server" with a Settings link when `unreachable`; "Set the server address in Settings" when `no_server`; hidden otherwise; animated in and out (reduce-motion safe).
  - `TabBar` Settings dot: signal colour when unreachable, outline colour when ok.
- [ ] **Step 1: Write the failing tests** (fake timers, mocked fetch): the first `apiFetch` network error or timeout flips the store to unreachable immediately (no retries waited for); a successful response flips it to ok; "Set a server URL in Settings." does not flip it to unreachable; health polling every 10 s while unreachable; success flips back to ok and stops polling; no server URL → `no_server` without polling.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** stop the laptop's server → banner within 10 s, libraries keep their rows; start it → banner disappears.
- [ ] **Step 6: Commit** `feat(mobile): add server status banner and tab dot`.

## Shared files with the mobile recording plan
This plan edits `app/_layout.tsx`, `TabBar.tsx` and `src/api/client.ts`; the recording plan adds the fan-out overlay to `app/_layout.tsx` and owns the recording page. Both may define a `useTags` hook with query key `["tags"]`; on rebase keep one. Whichever merges second rebases and keeps both.

## Self-review notes
- Spec coverage: UI §3 Chat (Tasks 1–2), Settings (Task 3), Everywhere banner (Task 4); §6 Chat run failures (Task 1), server unreachable (Task 4), error-code messages via `errorMessage` (foundation Task 9). Chat spec §6 states mapped in `nextRunView`.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 none; Task 4 needs 3 (no-server state uses the stored URL). Tasks 1 and 3 can run in parallel.
