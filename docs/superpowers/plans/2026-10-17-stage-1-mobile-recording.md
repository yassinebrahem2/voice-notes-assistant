# Stage 1 Mobile Recording Implementation Plan

> **For agentic workers:** implement this plan task by task as described in `docs/implementing-plan-tasks.md` (fresh implementer, fresh reviewer, fix loop per task); follow `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** approved. Branch `plan/stage-1-mobile-recording`, plan issue #19.

**Goal:** The recording half of the app: the ● fan-out and recorder with the live waveform, the upload queue, the Meetings and Notes libraries, the recording page (processing timeline, summary, transcript, speakers, note) and the player; Tier 2 polish last.

**Architecture:** Expo Router screens in `mobile/app/`, logic in `mobile/src/recording/`, `mobile/src/library/`, `mobile/src/detail/`, `mobile/src/player/`. Server data through TanStack Query hooks over the foundation's `apiFetch`; the upload uses XMLHttpRequest for progress. Animations with Reanimated on the UI thread. Logic is unit-tested; animated views are checked on a phone.

**Tech Stack:** Expo SDK 58, expo-router, expo-audio, expo-haptics, expo-file-system, expo-keep-awake, expo-crypto, react-native-reanimated 4 + react-native-worklets, React Native Paper 5, TanStack Query 5, jest-expo, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-ui.md` (§1–§6), `…-design-data-api.md` (§2–§5), `…-design-platform.md` §5 (platform quirks).

**Stage overview:** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. **Builds on:** the foundation mobile code (`apiFetch`, `ApiError`, `errorMessage` and the fan-out store `openFanOut`/`closeFanOut`/`useFanOut` (both foundation Task 9), `Schemas`, `queryClient`, `useServerUrl`, `tokens`, `paperTheme`, `motion`, `TabBar`, `RecordAction` (already calls `openFanOut()`; unchanged by this plan), generated `schema.d.ts`). Uses the processing plan's endpoints; until they land, the stub routes answer 501 and screens show their error state.

## Global Constraints (this plan)
- Everything in the overview's Global constraints.
- Native packages only with `npx expo install`. Must run in Expo Go.
- Colours, spacing, radius, type and motion only from `src/theme` tokens; no hex values in components.
- Every pressable ≥ 48 dp with ripple feedback and an accessibility label.
- Reduce motion (`useReducedMotion`) respected wherever something animates.
- The phone stores only the server URL, UI preferences and audio waiting to be uploaded (roadmap).

## Review Focus
1. Wi-Fi off during upload → file kept with its kind, "Not uploaded" row after restarting the app, Retry uploads once (same `client_upload_id`). (Task 4 test.)
2. Mic permission denied → explanation and Open Settings, no animation, nothing recorded. (Task 1 test.)
3. Leaving the app while recording in Expo Go → paused, Resume / Stop on return; never a silent loss, never a silent auto-resume. (Task 2 test.)
4. A rename or tag edit that fails → reverts with "Couldn't save". (Task 7 test.)
5. Opening a citation to a deleted recording → "This recording was deleted", not a crash. (Task 6 test.)

---

### Task 1: Record fan-out, permission and haptics

**Files:**
- Create: `mobile/src/recording/FanOutOverlay.tsx`, `mobile/src/recording/fanOut.ts`, `mobile/src/recording/permissions.ts`, `mobile/app/record.tsx` (placeholder: kind label, ✕ goes back, the full-screen colour fading out; Task 2 makes it the recorder, so the route and its typed path exist from this task on)
- Modify: `mobile/app/_layout.tsx` (render `<FanOutOverlay />` at root level above the tabs; `record` screen options: no animation, gestures off, no header), `mobile/jest.config.js` and a new `mobile/jest.setup.ts` (Reanimated and worklets test setup; the foundation has no setup file), `mobile/package.json` and lock file (via `npx expo install expo-audio expo-haptics expo-keep-awake expo-file-system expo-crypto react-native-reanimated react-native-worklets`; SDK 58 pins reanimated 4.7.1 and worklets 0.13.0; the foundation's `mobile/package.json` has neither reanimated nor worklets at the time of writing, so install them here if not already present, and let `npx expo install` choose every version)
- Test: `mobile/src/recording/fanOut.test.ts`, `mobile/src/recording/permissions.test.ts`, `mobile/src/recording/FanOutOverlay.test.tsx`

**Interfaces:**
- Consumes: the foundation's `openFanOut`/`closeFanOut`/`useFanOut()` (`mobile/src/recording/fanOutStore.ts`): the single source of open/closed. `RecordAction` already calls `openFanOut()` and is not modified.
- Produces:
  - `type FanOutPhase = "idle" | { chosen: RecordingKind }`; `fanOutReducer(phase: FanOutPhase, action: { choose: RecordingKind } | "reset"): FanOutPhase` (models only which disc was chosen; open/closed stays in the store).
  - `ensureMicPermission(): Promise<"granted" | "denied">` (asks once; `denied` → the caller shows the explanation sheet with "Open Settings" via `Linking.openSettings()`).
  - `FanOutOverlay` (root level, driven by `useFanOut()`): on open → permission check (denied → explanation sheet, `closeFanOut()`, no animation) → light haptic → Meeting (left) / Note (right) discs spring up above the ●, ● shown as ✕; tap outside or ✕ → `closeFanOut()` and `"reset"`. It lives in the root layout, not inside the tab bar, because Android does not deliver touches to children drawn outside their parent's bounds. Tap a kind → `{ choose }`, heavy haptic, the chosen disc scales to fill the screen as an overlay on the current screen (spring ≈ 280 ms; reduce motion → fade); when it covers the screen, `router.push({ pathname: "/record", params: { kind } })` with no default route animation, then `closeFanOut()` and `"reset"` once the record screen has mounted behind an identical full-screen colour.
- [ ] **Step 1: Install** the packages with the `npx expo install …` line above; add the Jest setup.
- [ ] **Step 2: Write the failing tests:** `fanOutReducer` transitions (`idle` + choose → chosen; choose while chosen is ignored; `"reset"` → `idle`); `ensureMicPermission` returns `denied` without prompting again when already denied, and `granted` after a granted prompt (mock `expo-audio`); overlay test with RNTL: denied permission shows the explanation and "Open Settings", and no disc is rendered.
- [ ] **Step 3: Run** `npx jest src/recording` → FAIL. **Step 4: Implement.** **Step 5: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 6 (phone, Expo Go):** the fan-out opens and cancels from every tab; both discs take taps; deny permission → explanation, nothing animates.
- [ ] **Step 7: Commit** `feat(mobile): add the record fan-out`.

### Task 2: Recorder screen and levels

**Files:**
- Create: `mobile/src/recording/useRecorder.ts`, `mobile/src/recording/environment.ts`, `mobile/src/recording/levels.ts`
- Modify: `mobile/app/record.tsx` (the recorder), `mobile/app.config.ts` (plugin `["expo-audio", { "microphonePermission": "…", "enableBackgroundRecording": true }]`)
- Test: `mobile/src/recording/levels.test.ts`, `mobile/src/recording/environment.test.ts`, `mobile/src/recording/useRecorder.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `isExpoGo(): boolean` (`Constants.executionEnvironment === "storeClient"`); `audioModeFor(isExpoGo: boolean)` → `{ allowsRecording: true, allowsBackgroundRecording: !isExpoGo, … }`; `shouldPauseOnReturn(isExpoGo: boolean, wasBackgrounded: boolean): boolean` (true only for both).
  - `dbfsToLevel(db: number | undefined): number` (clamp −50…0 dBFS to 0…1; `undefined` and −160 → 0).
  - `useRecorder(kind: RecordingKind)`: creates the recorder with `useAudioRecorder({ …, isMeteringEnabled: true })`; `prepare()` (called while the transition runs), `start()`, `stop(): Promise<{ uri: string; durationMs: number }>`, `discard()`, `pause()`, `resume()`; exposes `level: SharedValue<number>`, `elapsedMs`, `paused`. Keeps the screen awake while recording.
    - Levels: in expo-audio 58.0.9 the `useAudioRecorder` status listener only receives `{ id, isFinished, hasError, error, url }` on stop or error; `metering` and `durationMillis` come only from `recorder.getStatus()`. So while recording, a `setInterval` every 50 ms calls `recorder.getStatus()` and writes `level.value = dbfsToLevel(status.metering)` (a shared value: no React re-render); `elapsedMs` (React state) is updated from `status.durationMillis` at most 4× per second. The interval is cleared on pause, stop, discard and unmount. Never `useAudioRecorderState` (it re-renders the screen on every poll).
    - Expo Go background: expo-audio pauses the recorder when the app goes to the background and calls `resumeAfterSystemPause()` on its own when the app returns to the foreground. An `AppState` listener records that the app went to the background; on `"active"`, if `shouldPauseOnReturn(isExpoGo(), wasBackgrounded)`: if `recorder.getStatus().isRecording` then `recorder.pause()`; then `paused = true`, which shows the paused banner with Resume / Stop. In the EAS build recording continues in the background and nothing changes.
  - `app/record.tsx`: kind label at the top; mounts behind the full-screen colour from Task 1, calls `prepare()` and then `start()`, and fades the colour out; level placeholder (Task 3 adds the waveform and level ring); timer in Plex Mono; Stop (medium haptic); ✕ and Android back ask "Discard recording?"; Expo Go line "Keep the app open while recording"; paused banner "Paused while the app was in the background" with Resume / Stop. Stop returns the file; Task 4 hands it to the upload (until then Stop goes back).
- [ ] **Step 1:** add the plugin to `app.config.ts`.
- [ ] **Step 2: Write the failing tests:** `dbfsToLevel` table (−160 → 0, −50 → 0, −25 → 0.5, 0 → 1, +3 → 1, undefined → 0); `audioModeFor(true).allowsBackgroundRecording === false`; `shouldPauseOnReturn` table (only `(true, true)` → true); `useRecorder` with mocked `expo-audio` and jest fake timers: after `start()`, advancing 50 ms calls `getStatus()` and sets `level.value` from `metering`; over 1 s `elapsedMs` changes at most 4 times; after `stop()` no further `getStatus()` calls; returning to `"active"` after `"background"` in Expo Go with `isRecording: true` calls `pause()` and sets `paused`; outside Expo Go nothing is paused.
- [ ] **Step 3: Run** `npx jest src/recording` → FAIL. **Step 4: Implement.** **Step 5: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 6 (phone, Expo Go):** Meeting and Note both record; background the app → paused banner on return, the recording does not continue until Resume; Resume continues the same file.
- [ ] **Step 7: Commit** `feat(mobile): add the recorder screen with levels`.

### Task 3: Live waveform and level ring

**Files:**
- Create: `mobile/src/recording/levelBuffer.ts`, `mobile/src/recording/Waveform.tsx`, `mobile/src/recording/LevelRing.tsx`
- Modify: `mobile/app/record.tsx` (use them)
- Test: `mobile/src/recording/levelBuffer.test.ts`

**Interfaces:**
- Consumes: `level: SharedValue<number>` (Task 2).
- Produces:
  - `pushLevel(buffer: number[], level: number, size = 48): number[]` (worklet-safe; newest last, oldest dropped).
  - `Waveform({ level })`: ≈ 48 `Animated.View` bars driven by a shared buffer, scrolling right to left; newest bar in `signal`, older bars fading to `inkMuted`; with reduce motion, a single level bar.
  - `LevelRing({ level })`: ring around the Stop disc whose scale follows `level` with a spring.
- [ ] **Step 1: Write the failing tests:** `pushLevel` keeps size, appends newest last, drops oldest, clamps to 0…1.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** bars move with the voice at a steady frame rate; the recorder screen does not re-render while levels change (React DevTools or a render counter).
- [ ] **Step 6: Commit** `feat(mobile): add live waveform and level ring`.

### Task 4: Upload queue and upload progress

**Files:**
- Create: `mobile/src/recording/pending.ts`, `mobile/src/recording/upload.ts`, `mobile/src/recording/usePendingUploads.ts`
- Modify: `mobile/app/record.tsx` (Stop → upload ring → check → `router.replace("/recording/<id>")`, so Back from the recording page goes to the library, never into the recorder; failure → Retry on the ring)
- Test: `mobile/src/recording/pending.test.ts`, `mobile/src/recording/upload.test.ts`

**Interfaces:**
- Consumes: Task 2 (`stop()` result).
- Produces:
  - `PendingUpload { clientUploadId: string; kind: RecordingKind; path: string; createdAt: string; durationMs: number }`.
  - `enqueue(uri, kind, durationMs): Promise<PendingUpload>`: moves the file from the cache directory into `pending/<clientUploadId>.m4a` under `Paths.document` with the SDK 58 object API (`new Directory(Paths.document, "pending").create({ idempotent: true })`, `await new File(uri).move(dest)`; verified in expo-file-system 58.0.9: `Paths.document`, `File`, `Directory`, `move`, `delete`, `exists`; not the `legacy` `documentDirectory` API) (Android may clear the cache) and adds it to the AsyncStorage index `pending_uploads`; `clientUploadId` = a random UUID (`expo-crypto` `randomUUID`, installed in Task 1).
  - `listPending(): Promise<PendingUpload[]>` (drops index entries whose file is missing); `removePending(id)` (file + index).
  - `uploadPending(item, onProgress: (fraction: number) => void): Promise<Schemas["RecordingOut"]>`: XMLHttpRequest multipart POST `/api/v1/recordings` with FormData fields `kind`, `client_upload_id` and the file part `` { uri: <file uri>, name: `${clientUploadId}.m4a`, type: "audio/mp4" } `` (the server takes the extension from the file name; without it the upload is rejected with 415); `upload.onprogress` → fraction; no short timeout (a 30-minute m4a is tens of MB over the tailnet): the request is aborted only by the user; 200 or 201 → `removePending`; errors → `ApiError` (network, timeout, contract) and the item stays.
  - `enqueueAndUpload(uri, kind, durationMs, onProgress)` used by the recorder.
  - `usePendingUploads()`: `{ items, retry(id), remove(id) }`, refreshed on focus.
- [ ] **Step 1: Write the failing tests** (mock expo-file-system, AsyncStorage and XMLHttpRequest):
  - `test enqueue moves file out of cache and indexes it`; `listPending drops entries with missing files`.
  - `uploadPending sends the file part named <clientUploadId>.m4a with type audio/mp4`; `uploadPending reports progress fractions and removes on 201`; `…on 200 (existing) also removes`; `…network error keeps the item and throws network_error`; `retry reuses the same client_upload_id`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5 (phone):** upload with Wi-Fi off → Retry shown; kill and reopen the app → "Not uploaded" row (Task 5) → Retry works.
- [ ] **Step 6: Commit** `feat(mobile): add upload queue with progress and retry`.

### Task 5: Meetings and Notes libraries

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

### Task 6: Recording page (read-only)

**Files:**
- Create: `mobile/app/recording/[id].tsx`, `mobile/src/detail/useRecording.ts`, `mobile/src/detail/mutations.ts` (`useRetryRecording`; Task 7 adds the edit mutations), `mobile/src/detail/turns.ts`, `mobile/src/detail/timeline.ts`, `mobile/src/detail/ProcessingTimeline.tsx`, `mobile/src/detail/SummaryView.tsx`, `mobile/src/detail/TranscriptView.tsx`, `mobile/src/detail/NoteView.tsx`
- Test: `mobile/src/detail/turns.test.ts`, `mobile/src/detail/timeline.test.ts`, `mobile/src/detail/useRecording.test.ts`, `mobile/src/detail/RecordingScreen.test.tsx`

**Interfaces:**
- Consumes: Task 5's query keys; Task 8's player (`usePlayer`, `PlayerBar`); until Task 8, the page renders without the player bar.
- Produces:
  - `useRecording(id)` (`GET /recordings/{id}`, polling every 2 s while non-terminal; 404 → `deleted: true`; never retries a 404: `retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2`).
  - `groupTurns(segments, speakers): Turn[]` (consecutive segments of one speaker → one turn with the first segment's start; notes → one turn per segment).
  - `timelineSteps(kind, status, failedStep): { step; state: "done" | "current" | "todo" | "failed" }[]` (meetings include "Finding speakers").
  - `useRetryRecording()` (`POST /recordings/{id}/retry`; on success invalidates the recording and list queries).
  - Screen: processing → `ProcessingTimeline` (current step animated) or failed message + Retry; ready meeting → title and tag chips (read-only here), segmented button Summary | Transcript (no swipe), summary items with citation chips, transcript turns with speaker colours from `tokens.speaker[i]` and speaker chips; ready note → key points (cited), clean note, Transcript; a ready recording with no segments (the server's empty analysis: empty overview and lists, or no key points and empty clean text) → "Nothing was said" instead of the summary or note cards; `?segment=<id>` scrolls to and highlights that segment (Task 8 also starts playback there); deleted → "This recording was deleted". The ready reveal staggers the cards in.
- [ ] **Step 1: Write the failing tests:** `groupTurns` (merge, speaker change, notes); `timelineSteps` for meeting/note × each status incl. failed; `useRecording` does not retry a 404 (one fetch) and retries a network error; screen shows the deleted state on 404, "Nothing was said" for a ready recording with no segments, the failed message with Retry calling the retry endpoint, and highlights the segment named by `?segment=`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5: Commit** `feat(mobile): add the read-only recording page`.

### Task 7: Recording page edits

**Files:**
- Create: `mobile/src/detail/SpeakerRenameDialog.tsx`, `mobile/src/detail/HeaderMenu.tsx`
- Modify: `mobile/src/detail/mutations.ts`, `mobile/app/recording/[id].tsx`, `mobile/src/detail/SummaryView.tsx`, `mobile/src/detail/TranscriptView.tsx`
- Test: `mobile/src/detail/mutations.test.ts`, `mobile/src/detail/RecordingScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 6.
- Produces:
  - Mutations with optimistic updates and rollback (`onMutate` snapshot, `onError` restore + snackbar "Couldn't save", `onSettled` invalidate): `useUpdateRecording` (title, tags), `useRenameSpeaker`, `useDeleteRecording` (confirm; success → back + "Deleted" snackbar; 409 → "Available when processing finishes").
  - Screen: editable title and tag chips (ready only); speaker chips and tap-on-name → `SpeakerRenameDialog`; ⋮ `HeaderMenu` with Delete in red, disabled while `processing`.
- [ ] **Step 1: Write the failing tests:** optimistic rename rollback on error (QueryClient with a failing mutation fn; the old name is back and "Couldn't save" shown); title/tag edit rollback; delete 409 shows "Available when processing finishes"; Delete disabled while processing.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → clean.
- [ ] **Step 5: Commit** `feat(mobile): add recording page edits`.

### Task 8: Player, then Tier 2 polish (cut first if late)

**Files:**
- Create: `mobile/src/player/usePlayer.ts`, `mobile/src/player/PlayerBar.tsx`, `mobile/src/player/activeSegment.ts`, `mobile/src/library/WaveThumb.tsx`, `mobile/src/player/Scrubber.tsx`
- Modify: `mobile/app/recording/[id].tsx` (player bar, citation seek, karaoke follow), `mobile/src/library/RecordingRow.tsx` (thumbnail)
- Test: `mobile/src/player/activeSegment.test.ts`, `mobile/src/player/usePlayer.test.ts`

**Interfaces:**
- Consumes: Task 6 (the page, `?segment=` highlight).
- Produces:
  - `usePlayer(recordingId)`: expo-audio player on `<server>/api/v1/recordings/<id>/audio` (served with Range); `playFrom(ms)`, `toggle()`, `positionMs`, `durationMs`, `error` → "Couldn't load audio" + Retry.
  - `PlayerBar`: fixed above the gesture bar; screen content inset so nothing hides behind it.
  - Tier 2 (built last; if cut, say so in the plan issue): `activeSegmentIndex(segments, positionMs): number` (binary search; before the first → −1); karaoke follow (highlight + auto-scroll; manual scroll pauses until "Follow" is tapped); `WaveThumb` from `waveform_peaks` in rows; `Scrubber` over the peaks with drag-to-seek.
- [ ] **Step 1: Write the failing tests:** `activeSegmentIndex` (start, middle, gap between segments, after the end); `usePlayer.playFrom` seeks then plays (mocked expo-audio).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the player, commit `feat(mobile): add the recording player`; then Tier 2, commit `feat(mobile): add karaoke follow, waveform thumbnails and scrubber`.
- [ ] **Step 4: Run** → clean after each commit.
- [ ] **Step 5 (phone):** tap a summary citation → jumps and plays that moment; the transcript follows playback.

## Shared files with the chat-settings plan
This plan adds `FanOutOverlay` and the `record` screen options to `app/_layout.tsx`, and owns `app/recording/[id].tsx` (the Chat plan only navigates to it). The chat-settings plan edits `TabBar` (status dot) and `app/_layout.tsx` (theme preference, server banner). Whichever merges second rebases and keeps both.

## Self-review notes
- Spec coverage: UI §1 routes and back behaviour (Tasks 1, 2, 4, 6); §2 recording (Tasks 1–4); §3 libraries and recording page (Tasks 5–7); §4 tokens used throughout; §5 Tier 1 motion (Tasks 1, 3, 5, 6), Tier 2 (Task 8); §6 app-side failures for uploads, edits, playback, deleted citations (Tasks 4, 6, 7, 8). Chat and Settings are plan 5.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 needs 2; Task 4 needs 2; Task 5 needs 4 (pending rows); Task 6 needs 5; Task 7 needs 6; Task 8 needs 6. Tasks 3 and 4 can run in parallel, and so can Tasks 7 and 8.
