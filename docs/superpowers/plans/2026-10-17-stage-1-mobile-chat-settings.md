# Stage 1 Mobile Chat and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Other agents (Codex, Antigravity, …):** work the tasks in order, one commit per task, ticking the boxes; follow `AGENTS.md`.

> **Status:** draft. Gets its branch `plan/stage-1-mobile-chat-settings` and plan issue after the foundation (#1) merges.

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
  - `api.ts`: `createChat()`, `ask(chatId, { text, scope, tag_ids })`, `getRun(chatId, runId)`, `retryRun(chatId, runId)` (typed with `Schemas`).
  - `runMachine.ts`: `RunView = { phase: "sending" | "running" | "done" | "failed" | "interrupted" | "too_slow"; steps: string[]; message?: MessageOut; error?: string }`; `nextRunView(prev: RunView, event: { poll: RunOut } | { pollError: ApiError } | { elapsedMs: number }): RunView` (404 → `interrupted`; `failed` → message from `errorMessage`; elapsed ≥ 90 000 → `too_slow`; network errors keep polling until 90 s).
  - `useChatSession()`: module-level store (survives tab switches while the app is open): `{ chatId, turns: { question, run: RunView }[], scope, tagIds, ask(text), retry(index), newChat(), setScope, setTagIds }`; polls every 500 ms while the latest run is `sending`/`running`; the chat is created lazily on the first question; `retry` calls `retryRun` (same run id; the question is not resent).
- [ ] **Step 1: Write the failing tests** (jest fake timers, mocked `apiFetch`):
  - `nextRunView` table: running with new steps; done with message; failed `ai_unavailable` → "Couldn't reach the AI right now."; 404 → interrupted; 90 s → too_slow.
  - `useChatSession`: ask → polls until done and stops; retry after interrupted calls `retryRun` once and resumes polling; state survives unmount/remount of the consumer (tab switch); `newChat` clears turns and the next ask creates a new chat.
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
  - Screen: scope selector (Notes / Meetings / Both, segmented) and tag chips at the top; empty chat → 3–4 starter questions (fixed list in the file); no ready recording yet → "Chat answers from your recordings. Record something first." with a Record button calling `openFanOut()` (UI spec §3); each turn shows the question, then the live `StatusLine` (last step, animated dots, reduce-motion safe), then the answer with citation chips (`router.push("/recording/<id>?segment=<seg>")`) or the fixed reply text; failed / interrupted / too slow → message + Retry; "New chat" in the header; input with send button (disabled while a run is going), keyboard-avoiding.
- [ ] **Step 1: Write the failing tests:** `splitAnswer` (markers in order, repeated marker, unknown marker kept as text); `citationLabel` formatting; screen: starters shown when empty; tapping a chip calls `router.push` with the segment; Retry visible on interrupted.
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
  - `testConnection(input: string): Promise<{ ok: true; health: HealthOut } | { ok: false; problem: "not_https" | "unreachable" | "not_this_server" }>`: normalises with `normalizeServerUrl`; `http://` → `not_https` without a request; `GET /api/v1/health` with a 5 s timeout; network error or timeout → `unreachable`; a response that is not `HealthOut` or whose `app_name` differs from `appInfo.name` → `not_this_server`.
  - `ThemePreference = "system" | "light" | "dark"`; `getThemePreference()`, `setThemePreference()` (AsyncStorage `theme`), `useThemePreference()`; the root layout picks `paperTheme(preference === "system" ? colorScheme : preference)`.
  - Screen: server URL field with Save and Test connection (result shown inline: "Connected", "Not HTTPS", "Can't reach the server", "That isn't this app's server"); theme segmented control; readiness list from `/health` roles ("Speech: fake (dev)", "Chat AI: missing GROQ_API_KEY", …); app name and version from `appInfo`.
- [ ] **Step 1: Write the failing tests:** `testConnection` cases (http → not_https with no fetch; timeout → unreachable; wrong app name → not_this_server; good → ok); theme preference round-trip and default `system`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5: Commit** `feat(mobile): add settings with connection test and theme`.

### Task 4: Server status banner and tab dot

**Files:**
- Create: `mobile/src/server/useServerStatus.ts`, `mobile/src/server/ServerBanner.tsx`
- Modify: `mobile/app/_layout.tsx` (banner above the tabs), `mobile/src/components/TabBar.tsx` (status dot on Settings), `mobile/src/api/queryClient.ts` (report network errors to the status store)
- Test: `mobile/src/server/useServerStatus.test.ts`

**Interfaces:**
- Produces:
  - `serverStatus` store: `"unknown" | "ok" | "unreachable" | "no_server"`; `reportNetworkError()` (called from the query client's `QueryCache({ onError })` and `MutationCache({ onError })` for `network_error`/`timeout`; TanStack Query 5 has no client-level `onError`), `reportOk()`; while `unreachable`, `GET /health` every 10 s, `ok` on success.
  - `ServerBanner`: "Can't reach the server" with a Settings link when `unreachable`; "Set the server address in Settings" when `no_server`; hidden otherwise; animated in and out (reduce-motion safe).
  - `TabBar` Settings dot: signal colour when unreachable, outline colour when ok.
- [ ] **Step 1: Write the failing tests** (fake timers, mocked fetch): a network error flips to unreachable; health polling every 10 s; success flips back to ok and stops polling; no server URL → `no_server` without polling.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** stop the laptop's server → banner within 10 s, libraries keep their rows; start it → banner disappears.
- [ ] **Step 6: Commit** `feat(mobile): add server status banner and tab dot`.

## Shared files with the mobile recording plan
This plan edits `app/_layout.tsx`, `TabBar.tsx` and `queryClient.ts`; the recording plan replaces `RecordAction` and owns the recording page. Both may define a `useTags` hook with query key `["tags"]`; on rebase keep one. Whichever merges second rebases and keeps both.

## Self-review notes
- Spec coverage: UI §3 Chat (Tasks 1–2), Settings (Task 3), Everywhere banner (Task 4); §6 Chat run failures (Task 1), server unreachable (Task 4), error-code messages via `errorMessage` (foundation Task 9). Chat spec §6 states mapped in `nextRunView`.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 none; Task 4 needs 3 (no-server state uses the stored URL). Tasks 1 and 3 can run in parallel.
