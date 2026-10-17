# Stage 1 Mobile Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Other agents (Codex, Antigravity, …):** work the tasks in order, one commit per task, ticking the boxes; follow `AGENTS.md`.

> **Status:** draft. Gets its branch `plan/stage-1-mobile-recording` and plan issue after the foundation (#1) merges.

**Goal:** The recording half of the app: the ● fan-out and recorder with the live waveform, the upload queue, the Meetings and Notes libraries, the recording page (processing timeline, summary, transcript, speakers, note) and the player; Tier 2 polish last.

**Architecture:** Expo Router screens in `mobile/app/`, logic in `mobile/src/recording/`, `mobile/src/library/`, `mobile/src/detail/`, `mobile/src/player/`. Server data through TanStack Query hooks over the foundation's `apiFetch`; the upload uses XMLHttpRequest for progress. Animations with Reanimated on the UI thread. Logic is unit-tested; animated views are checked on a phone.

**Tech Stack:** Expo SDK 58, expo-router, expo-audio, expo-haptics, expo-file-system, expo-keep-awake, react-native-reanimated, React Native Paper 5, TanStack Query 5, jest-expo, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-ui.md` (§1–§6), `…-design-data-api.md` (§2–§5), `…-design-platform.md` §5 (platform quirks).

**Stage overview:** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. **Builds on:** the foundation mobile code (`apiFetch`, `ApiError`, `errorMessage` and the fan-out store `openFanOut`/`closeFanOut`/`useFanOut` (both foundation Task 9), `Schemas`, `queryClient`, `useServerUrl`, `tokens`, `paperTheme`, `motion`, `TabBar`, `RecordAction` placeholder, generated `schema.d.ts`). Uses the processing plan's endpoints; until they land, the stub routes answer 501 and screens show their error state.

## Global Constraints (this plan)
- Everything in the overview's Global constraints.
- Native packages only with `npx expo install`. Must run in Expo Go.
- Colours, spacing, radius, type and motion only from `src/theme` tokens; no hex values in components.
- Every pressable ≥ 48 dp with ripple feedback and an accessibility label.
- Reduce motion (`useReducedMotion`) respected wherever something animates.
- The phone stores only the server URL, UI preferences and audio waiting to be uploaded (roadmap).

## Review Focus
1. Wi-Fi off during upload → file kept with its kind, "Not uploaded" row after restarting the app, Retry uploads once (same `client_upload_id`). (Task 3 test.)
2. Mic permission denied → explanation and Open Settings, no animation, nothing recorded. (Task 1 test.)
3. Leaving the app while recording in Expo Go → paused, Resume / Stop on return; never a silent loss. (Task 1 test.)
4. A rename or tag edit that fails → reverts with "Couldn't save". (Task 5 test.)
5. Opening a citation to a deleted recording → "This recording was deleted", not a crash. (Task 5 test.)

---

### Task 1: Record fan-out, permission and recorder

**Files:**
- Create: `mobile/app/record.tsx`, `mobile/src/recording/FanOutOverlay.tsx`, `mobile/src/recording/fanOut.ts`, `mobile/src/recording/useRecorder.ts`, `mobile/src/recording/permissions.ts`, `mobile/src/recording/environment.ts`, `mobile/src/recording/levels.ts`
- Modify: `mobile/src/recording/RecordAction.tsx` (replace the placeholder body: tap → `openFanOut()`), `mobile/app/_layout.tsx` (render `<FanOutOverlay />` at root level above the tabs; `record` screen options: no animation, gestures off, no header), `mobile/jest.setup.ts` and jest config (Reanimated and worklets test setup, if the foundation's setup does not cover them), `mobile/app.config.ts` (plugin `["expo-audio", { "microphonePermission": "…", "enableBackgroundRecording": true }]`), `mobile/package.json` (via `npx expo install expo-audio expo-haptics expo-keep-awake expo-file-system react-native-reanimated`)
- Test: `mobile/src/recording/fanOut.test.ts`, `mobile/src/recording/levels.test.ts`, `mobile/src/recording/environment.test.ts`, `mobile/src/recording/permissions.test.ts`

**Interfaces:**
- Produces:
  - `type FanOutState = "closed" | "open" | { chosen: RecordingKind }`; `fanOutReducer(state, action: "toggle" | "cancel" | { choose: RecordingKind }): FanOutState`.
  - `ensureMicPermission(): Promise<"granted" | "denied">` (asks once; `denied` → the caller shows the explanation sheet with "Open Settings" via `Linking.openSettings()`).
  - `isExpoGo(): boolean` (`Constants.executionEnvironment === "storeClient"`); `audioModeFor(isExpoGo: boolean)` → `{ allowsRecording: true, allowsBackgroundRecording: !isExpoGo, … }`.
  - `dbfsToLevel(db: number | undefined): number` (clamp −50…0 dBFS to 0…1; `undefined` and −160 → 0).
  - `useRecorder(kind: RecordingKind)`: creates the recorder with `isMeteringEnabled: true`; `prepare()` (called while the transition runs), `start()`, `stop(): Promise<{ uri: string; durationMs: number }>`, `discard()`; exposes `level: SharedValue<number>` (written from `useAudioRecorder`'s status listener, ≈ 50 ms; never `useAudioRecorderState`), `elapsedMs`, `paused` (true after the app was backgrounded in Expo Go; the recorder is paused by the system, verified `pauseForSystem`), `resume()`. Keeps the screen awake while recording.
  - `FanOutOverlay` (root level, driven by `useFanOut()`): on open → permission check → light haptic → Meeting (left) / Note (right) discs spring up above the ●, ● shown as ✕; tap outside or ✕ cancels. It lives in the root layout, not inside the tab bar, because Android does not deliver touches to children drawn outside their parent's bounds; tap a kind → heavy haptic, the chosen disc scales to fill the screen as an overlay on the current screen (spring ≈ 280 ms); when it covers the screen, `router.push("/record?kind=…")` with no default route animation; the recorder screen mounts behind an identical full-screen colour, calls `prepare()` and then `start()`, and fades the colour out.
  - `app/record.tsx`: kind label at the top; waveform and level ring from Task 2; timer in Plex Mono; Stop (medium haptic); ✕ and Android back ask "Discard recording?"; Expo Go line "Keep the app open while recording"; paused banner with Resume / Stop; Stop hands the file to Task 3's `enqueueAndUpload`; on success `router.replace("/recording/<id>")`, so Back from the recording page goes to the library, never into the recorder.
- [ ] **Step 1: Install** the packages with `npx expo install …`; add the plugin to `app.config.ts`.
- [ ] **Step 2: Write the failing tests:** fan-out reducer transitions (toggle, cancel, choose; choose from closed is ignored); `dbfsToLevel` table (−160 → 0, −50 → 0, −25 → 0.5, 0 → 1, +3 → 1, undefined → 0); `audioModeFor(true).allowsBackgroundRecording === false`; `ensureMicPermission` returns `denied` without prompting again when already denied (mock `expo-audio`).
- [ ] **Step 3: Run** `npx jest src/recording` → FAIL. **Step 4: Implement.** **Step 5: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 6 (phone, Expo Go):** fan-out opens and cancels; Meeting and Note both record; deny permission → explanation; background the app → paused banner on return.
- [ ] **Step 7: Commit** `feat(mobile): add record fan-out and recorder`.

### Task 2: Live waveform and level ring

**Files:**
- Create: `mobile/src/recording/levelBuffer.ts`, `mobile/src/recording/Waveform.tsx`, `mobile/src/recording/LevelRing.tsx`
- Modify: `mobile/app/record.tsx` (use them)
- Test: `mobile/src/recording/levelBuffer.test.ts`

**Interfaces:**
- Consumes: `level: SharedValue<number>` (Task 1).
- Produces:
  - `pushLevel(buffer: number[], level: number, size = 48): number[]` (worklet-safe; newest last, oldest dropped).
  - `Waveform({ level })`: ≈ 48 `Animated.View` bars driven by a shared buffer, scrolling right to left; newest bar in `signal`, older bars fading to `inkMuted`; with reduce motion, a single level bar.
  - `LevelRing({ level })`: ring around the Stop disc whose scale follows `level` with a spring.
- [ ] **Step 1: Write the failing tests:** `pushLevel` keeps size, appends newest last, drops oldest, clamps to 0…1.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** bars move with the voice at a steady frame rate; the recorder screen does not re-render while levels change (React DevTools or a render counter).
- [ ] **Step 6: Commit** `feat(mobile): add live waveform and level ring`.

### Task 3: Upload queue and upload progress

**Files:**
- Create: `mobile/src/recording/pending.ts`, `mobile/src/recording/upload.ts`, `mobile/src/recording/usePendingUploads.ts`
- Modify: `mobile/app/record.tsx` (Stop → upload ring → check → `router.replace("/recording/<id>")`; failure → Retry on the ring)
- Test: `mobile/src/recording/pending.test.ts`, `mobile/src/recording/upload.test.ts`

**Interfaces:**
- Produces:
  - `PendingUpload { clientUploadId: string; kind: RecordingKind; path: string; createdAt: string; durationMs: number }`.
  - `enqueue(uri, kind, durationMs): Promise<PendingUpload>`: moves the file from the cache directory into `pending/<clientUploadId>.m4a` under `Paths.document` with the SDK 58 object API (`new Directory(Paths.document, "pending").create({ idempotent: true })`, `await new File(uri).move(dest)`; verified in expo-file-system 58.0.9: `Paths.document`, `File`, `Directory`, `move`, `delete`, `exists`; not the `legacy` `documentDirectory` API) (Android may clear the cache) and adds it to the AsyncStorage index `pending_uploads`; `clientUploadId` = a random UUID (`expo-crypto` `randomUUID`, installed with `npx expo install`).
  - `listPending(): Promise<PendingUpload[]>` (drops index entries whose file is missing); `removePending(id)` (file + index).
  - `uploadPending(item, onProgress: (fraction: number) => void): Promise<Schemas["RecordingOut"]>`: XMLHttpRequest multipart POST `/api/v1/recordings` (`kind`, `client_upload_id`, `file`), `upload.onprogress` → fraction; no short timeout (a 30-minute m4a is tens of MB over the tailnet): the request is aborted only by the user; 200 or 201 → `removePending`; errors → `ApiError` (network, timeout, contract) and the item stays.
  - `enqueueAndUpload(uri, kind, durationMs, onProgress)` used by the recorder.
  - `usePendingUploads()`: `{ items, retry(id), remove(id) }`, refreshed on focus.
- [ ] **Step 1: Write the failing tests** (mock expo-file-system, AsyncStorage and XMLHttpRequest):
  - `test enqueue moves file out of cache and indexes it`; `listPending drops entries with missing files`.
  - `uploadPending reports progress fractions and removes on 201`; `…on 200 (existing) also removes`; `…network error keeps the item and throws network_error`; `retry reuses the same client_upload_id`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** upload with Wi-Fi off → Retry shown; kill and reopen the app → "Not uploaded" row (Task 4) → Retry works.
- [ ] **Step 6: Commit** `feat(mobile): add upload queue with progress and retry`.

### Task 4: Meetings and Notes libraries

**Files:**
- Create: `mobile/src/library/useRecordings.ts`, `mobile/src/library/useTags.ts`, `mobile/src/library/rowStatus.ts`, `mobile/src/library/LibraryScreen.tsx`, `mobile/src/library/RecordingRow.tsx`, `mobile/src/library/PendingRow.tsx`, `mobile/src/library/filters.ts`
- Modify: `mobile/app/(tabs)/meetings.tsx`, `mobile/app/(tabs)/notes.tsx` (render `<LibraryScreen kind=… />`)
- Test: `mobile/src/library/rowStatus.test.ts`, `mobile/src/library/filters.test.ts`, `mobile/src/library/LibraryScreen.test.tsx`

**Interfaces:**
- Produces:
  - `useRecordings({ kind, q, tagIds })` (`GET /recordings`), polling every 2 s while any item is non-terminal (`needsPolling(list)`), else no polling; `useTags()` (`GET /tags`).
  - `rowStatus(r: Schemas["RecordingOut"]): { label: string; progress: number | null; tone: "normal" | "error" }` (uploaded "Waiting…", transcribing "Transcribing…", diarizing "Finding speakers…", analyzing "Summarizing…", indexing "Indexing…", failed → the error message; ready → none).
  - Search is debounced by 300 ms.
  - Filters kept per tab in memory (search text, tags, scroll offset) so returning restores them.
  - Screen: search bar (tags as suggestions before typing), tag chips, pending rows on top, rows (title or "Untitled recording", date, duration in Plex Mono, tags, status line with thin progress), skeletons while loading, empty states (no server → Open Settings; nothing yet → "Record your first meeting/note" pointing at ●; no matches → Clear filters), error state with Retry; row press-in prefetches the detail; list enter stagger and layout transitions with reduce-motion fallback.
- [ ] **Step 1: Write the failing tests:** `rowStatus` table for every status; `needsPolling`; filters round-trip per tab; screen renders the three empty states (mocked hooks) and a pending row above server rows.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5: Commit** `feat(mobile): add Meetings and Notes libraries`.

### Task 5: Recording page (the largest task; split summary/transcript from edits if it drags)

**Files:**
- Create: `mobile/app/recording/[id].tsx`, `mobile/src/detail/useRecording.ts`, `mobile/src/detail/mutations.ts`, `mobile/src/detail/turns.ts`, `mobile/src/detail/timeline.ts`, `mobile/src/detail/ProcessingTimeline.tsx`, `mobile/src/detail/SummaryView.tsx`, `mobile/src/detail/TranscriptView.tsx`, `mobile/src/detail/NoteView.tsx`, `mobile/src/detail/SpeakerRenameDialog.tsx`, `mobile/src/detail/HeaderMenu.tsx`
- Test: `mobile/src/detail/turns.test.ts`, `mobile/src/detail/timeline.test.ts`, `mobile/src/detail/mutations.test.ts`, `mobile/src/detail/RecordingScreen.test.tsx`

**Interfaces:**
- Consumes: Task 4's query keys; Task 6's player (`usePlayer`, `PlayerBar`); until Task 6, the page renders without the player bar.
- Produces:
  - `useRecording(id)` (`GET /recordings/{id}`, polling every 2 s while non-terminal; 404 → `deleted: true`).
  - `groupTurns(segments, speakers): Turn[]` (consecutive segments of one speaker → one turn with the first segment's start; notes → one turn per segment).
  - `timelineSteps(kind, status, failedStep): { step; state: "done" | "current" | "todo" | "failed" }[]` (meetings include "Finding speakers").
  - Mutations with optimistic updates and rollback (`onMutate` snapshot, `onError` restore + snackbar "Couldn't save", `onSettled` invalidate): `useUpdateRecording` (title, tags), `useRenameSpeaker`, `useDeleteRecording` (confirm; success → back + "Deleted" snackbar; 409 → "Available when processing finishes"), `useRetryRecording`.
  - Screen: processing → `ProcessingTimeline` (current step animated) or failed message + Retry; ready meeting → editable title and tag chips, segmented button Summary | Transcript (no swipe), summary items with citation chips, transcript turns with speaker colours from `tokens.speaker[i]`, speaker chips and tap-on-name → rename dialog; ready note → key points (cited), clean note, Transcript; ⋮ menu with Delete in red, disabled while `processing`; `?segment=<id>` scrolls to and highlights that segment and starts playback (Task 6); deleted → "This recording was deleted". The ready reveal staggers the cards in.
- [ ] **Step 1: Write the failing tests:** `groupTurns` (merge, speaker change, notes); `timelineSteps` for meeting/note × each status incl. failed; optimistic rename rollback on error (QueryClient with a failing mutation fn); screen shows the deleted state on 404 and disables Delete while processing.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5: Commit** `feat(mobile): add the recording page`.

### Task 6: Player, then Tier 2 polish (cut first if late)

**Files:**
- Create: `mobile/src/player/usePlayer.ts`, `mobile/src/player/PlayerBar.tsx`, `mobile/src/player/activeSegment.ts`, `mobile/src/library/WaveThumb.tsx`, `mobile/src/player/Scrubber.tsx`
- Modify: `mobile/app/recording/[id].tsx` (player bar, citation seek, karaoke follow), `mobile/src/library/RecordingRow.tsx` (thumbnail)
- Test: `mobile/src/player/activeSegment.test.ts`, `mobile/src/player/usePlayer.test.ts`

**Interfaces:**
- Produces:
  - `usePlayer(recordingId)`: expo-audio player on `<server>/api/v1/recordings/<id>/audio` (served with Range); `playFrom(ms)`, `toggle()`, `positionMs`, `durationMs`, `error` → "Couldn't load audio" + Retry.
  - `PlayerBar`: fixed above the gesture bar; screen content inset so nothing hides behind it.
  - Tier 2 (built last; if cut, say so in the plan issue): `activeSegmentIndex(segments, positionMs): number` (binary search; before the first → −1); karaoke follow (highlight + auto-scroll; manual scroll pauses until "Follow" is tapped); `WaveThumb` from `waveform_peaks` in rows; `Scrubber` over the peaks with drag-to-seek.
- [ ] **Step 1: Write the failing tests:** `activeSegmentIndex` (start, middle, gap between segments, after the end); `usePlayer.playFrom` seeks then plays (mocked expo-audio).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the player, commit `feat(mobile): add the recording player`; then Tier 2, commit `feat(mobile): add karaoke follow, waveform thumbnails and scrubber`.
- [ ] **Step 4: Run** → clean after each commit.
- [ ] **Step 5 (phone):** tap a summary citation → jumps and plays that moment; the transcript follows playback.

## Shared files with the chat-settings plan
This plan replaces `RecordAction`, adds `FanOutOverlay` and the `record` screen options to `app/_layout.tsx`, and owns `app/recording/[id].tsx` (the Chat plan only navigates to it). The chat-settings plan edits `TabBar` (status dot) and `app/_layout.tsx` (theme preference, server banner). Whichever merges second rebases and keeps both.

## Self-review notes
- Spec coverage: UI §1 routes and back behaviour (Tasks 1, 3, 5); §2 recording (Tasks 1–3); §3 libraries and recording page (Tasks 4–5); §4 tokens used throughout; §5 Tier 1 motion (Tasks 1, 2, 4, 5), Tier 2 (Task 6); §6 app-side failures for uploads, edits, playback, deleted citations (Tasks 3, 5, 6). Chat and Settings are plan 5.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 needs 1; Task 4 needs 3 (pending rows); Task 5 needs 4; Task 6 needs 5. Tasks 2 and 3 can run in parallel.
