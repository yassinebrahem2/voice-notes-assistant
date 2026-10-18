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

### Task 9: Merge main and final-review fixes

Follow-up from the lead's review of PR #68 (plan issue #19). The branch conflicts with `main` (the chat-settings plan merged first), several §6 failure paths are missing or lose data, one workaround was added without a decision, and the phone checks of Tasks 4 and 8 have no recorded result. The lead's decisions are written in as requirements: merge (not rebase), pending uploads listed from disk as the spec says, the Expo Go fallback removed. Work in the order below; part A comes first because later parts use `main`'s helpers.

**Files:**
- Modify:
  - `mobile/app/_layout.tsx`, `mobile/app/record.tsx`, `mobile/app/recording/[id].tsx`
  - `mobile/src/recording/pending.ts`, `upload.ts`, `useRecorder.ts`, `environment.ts`, `usePendingUploads.ts`, `FanOutOverlay.tsx`, `Waveform.tsx`
  - `mobile/src/library/LibraryScreen.tsx`, `LibraryEmptyState.tsx`, `PendingRow.tsx`, `RecordingRow.tsx`
  - `mobile/src/chat/useChatData.ts`, `mobile/src/chat/ChatScreen.tsx` (its `useTags` import)
  - `mobile/src/detail/mutations.ts`, `useRecording.ts`, `RecordingHeader.tsx`, `HeaderMenu.tsx`, `TranscriptView.tsx`, `SummaryView.tsx`, `NoteView.tsx`, `SpeakerRenameDialog.tsx`, `ProcessingTimeline.tsx`
  - `mobile/src/player/usePlayer.ts`, `PlayerBar.tsx`, `Scrubber.tsx`
- Create: `mobile/src/recording/MicrophoneExplanation.tsx` (moved out of `FanOutOverlay.tsx`), `mobile/src/recording/RecorderBanner.tsx` and `mobile/src/recording/DiscardDialog.tsx` (moved out of `record.tsx`), `mobile/src/components/snackbarStore.ts`, `mobile/src/components/AppSnackbar.tsx`, `mobile/src/format.ts` (one duration and date formatter)
- Test: `mobile/src/recording/{pending,upload,useRecorder,environment,usePendingUploads,FanOutOverlay}.test.ts(x)`, `mobile/src/recording/Recorder.test.tsx` (new: the recorder screen's failure paths), `mobile/src/library/LibraryScreen.test.tsx`, `mobile/src/detail/{mutations,useRecording,RecordingScreen,RecordingScreenEdits}.test.ts(x)`, `mobile/src/player/{usePlayer,PlayerBar}.test.ts(x)`, `mobile/src/chat/ChatScreen.test.tsx` (only if it mocks `useTags` from `./useChatData`), `mobile/src/components/snackbarStore.test.ts`, `mobile/src/format.test.ts`

**A. Merge `main`** (merge commit, never rebase or force-push: the branch has other people's commits)
- `git merge origin/main`. `app/_layout.tsx`: keep both sides (`ServerBanner`, theme preference and splash gating from `main`; `FanOutOverlay` and the `record` screen options from this plan). The merge commit only resolves the conflict; run jest, tsc, eslint, prettier on it, then push.
- Then, as its own commit `refactor(mobile): keep one useTags hook`: one `useTags` (the chat-settings plan's note: "keep one"). Keep `mobile/src/library/useTags.ts`, delete the copy in `chat/useChatData.ts`, point `ChatScreen.tsx` at the library one.

**B. Pending uploads follow spec §6** ("pending files are listed from the document directory with a small index in AsyncStorage")
- The file name carries the kind: `pending/<clientUploadId>.<kind>.m4a`. `listPending()` lists `pending/` on disk and is the source of truth; the AsyncStorage index `pending_uploads` only adds `createdAt` and `durationMs`. `PendingUpload.durationMs` becomes `number | null`. A file with no index entry is still listed, with `createdAt` from `file.info().modificationTime` (verified in expo-file-system 58.0.9: `File.info()` is synchronous and returns `FileInfo` with `modificationTime` in ms) and `durationMs: null`, which the row shows as "—". Index entries with no file are dropped. A file named `<id>.m4a` (written before this task) takes its kind from the index and is renamed to `<id>.<kind>.m4a` on that listing; with no index entry it is skipped.
- Every index write goes through one module-level promise queue (`enqueue`, `removePending` and the clean-up in `listPending` run one after another). A failed or unparsable index read is never followed by a write of a shorter list: the index is rebuilt from the files on disk.
- The upload's file part keeps `` name: `${clientUploadId}.m4a` ``, `type: 'audio/mp4'` (the server takes the extension from it).
- `upload.ts` uses `main`'s rules for errors: a 502/503/504 without the API error envelope (`isGatewayStatus`, `isApiErrorEnvelope`) → `reportNetworkError()` and `ApiError(0, 'network_error', …)`; a network error → `reportNetworkError()`; a 2xx → `reportOk()`. Remove the unused `signal` parameter (nothing aborts an upload; the "aborted → `timeout`" mapping goes with it) and the unused `enqueueAndUpload` (the recorder keeps the pending item between enqueue and upload for Retry; this replaces that line of Task 4's interface).
- After any successful upload (recorder or library Retry), invalidate `['recordings']` so the new recording shows in the library when you return to it.
- Tests: two `enqueue` calls started together both end up in the index; a failed index read followed by `enqueue` keeps the other pending files listed; a file in `pending/` with no index entry is listed with its kind; an index entry with no file is dropped; a 502 with an HTML body → `network_error` and status `unreachable`; a successful upload invalidates `['recordings']`.

**C. Recorder failure paths (spec §6: "Recorder error mid-recording: stop; if the file is playable, offer Save / Discard, else say it failed.")**
- `useRecorder` passes a status listener to `useAudioRecorder(options, statusListener)` (expo-audio 58.0.9: `statusListener?: (status: RecordingStatus) => void`, `RecordingStatus = { id, isFinished, hasError, error: string | null, url: string | null, … }`). On `hasError` it stops polling, calls `recorder.stop()` (inside try/catch; Android's `onError` emits the status without stopping `MediaRecorder`, so the file may never be finalised), and exposes `error: string | null` to the screen. The screen then checks the file really plays. The file is `recorder.uri` (the error status has `url: null`). Playable means: the file exists, and `createAudioPlayer(uri)` (expo-audio 58.0.9: `createAudioPlayer(source?, options?): AudioPlayer`) reports `isLoaded` with `duration > 0` within 3 s. A `playbackStatusUpdate` carrying `error`, a zero duration, or no load within 3 s means not playable. The player is released in every case. Playable → Save / Discard (Save = enqueue and upload as after Stop); otherwise "Recording failed" with Close (the cache file is deleted).
- `prepare()` or `start()` failing → "Couldn't start recording" with Close, and no Stop button (today the error is only logged and the screen looks like it is recording).
- Stop runs once: both Stop buttons (footer and paused banner) are disabled from the first tap until the screen leaves the recording state.
- `enqueue` failing after Stop → "Couldn't save the recording" with Retry, which tries `enqueue` again with the same file URI (today Retry does nothing because there is no pending item yet). The cache file is not deleted.
- `discard()` deletes the recorded cache file; it only ignores a stop error when the recorder is already stopped, and logs any other error.
- Tests: a recorder status update with `hasError` and a playable file (mocked player with `duration > 0`) shows Save and Discard, Save enqueues; with no file, a zero duration, or a player that never loads (after 3 s), "Recording failed", and the player is released; `start()` rejecting shows "Couldn't start recording" and no Stop button; two quick Stop taps call `recorder.stop()` once and `enqueue` once; `enqueue` rejecting once then succeeding on Retry uploads the same URI; Discard deletes the cache file.

**D. Expo Go detection (lead's decision: remove the fallback)**
- Remove `markAsExpoGo`, `resetExpoGoDetection`, the retry on an error message containing "recording service", the `appOwnership` check and the duplicated doc comment. `isExpoGo()` is `Constants.executionEnvironment === ExecutionEnvironment.StoreClient` again (platform spec §5). In expo-audio 58.0.9 that error comes from binding the background-recording service during `prepareToRecordAsync`, which can also fail in the EAS build (5 s bind timeout, a second bind while one is running); the fallback would then silently turn background recording off there.
- `record.tsx` drops the `expoGoClient` state and calls `isExpoGo()`.
- Before changing D's code, do Step 2 (the phone check of `executionEnvironment`). If Expo Go does not report `storeClient`, the reverted check would set `allowsBackgroundRecording: true` there and recording could not start, and part E's pause-on-return (which runs only when `isExpoGo()` is true) would never run. Then parts D and E wait for the lead's answer in the issue (the platform spec changes before the code does); parts A–C and F–H continue. Commits `79c9afd` and `3b78e61` were made because the check came back false in Expo Go, so expect this.

**E. Pause on return in Expo Go (Review Focus 3)**
- On `"active"` after `"background"` in Expo Go, while the screen is recording and not already paused by the user: call `recorder.pause()` whether `getStatus().isRecording` is true or not (inside try/catch: an error is logged with `console.warn`), then set `paused = true` in every case. The plan's Task 2 sets `paused` after that check, whatever its result; the code sets it only when `isRecording` is true. In expo-audio 58.0.9 (`AudioRecorder.kt`) a user `pause()` clears `isPausedBySystem`, so expo-audio cannot resume the recorder later without the user choosing to, and a second pause keeps the recorded duration (`getAudioRecorderDurationMillis` adds nothing while not recording).
- Set `level` to 0 on pause so the waveform does not freeze at the last level.
- Tests: on `"active"` with `isRecording: false` the paused banner shows and `pause()` is called; `pause()` throwing still shows the banner; `level` is 0 after pause.

**F. Recording page**
- Any error other than 404 → the error message from `errorMessage(error)` with Retry (`refetch`); the skeleton only while the first load is running. Today any other error (network, the 501 stubs) keeps the skeleton up forever.
- "Nothing was said" follows the spec: a ready recording with no segments. A recording with segments but an empty summary shows its transcript.
- Delete: the "Deleted" snackbar must be seen after going back. Add an app-level snackbar (`snackbarStore.ts`: `showSnackbar(message)`, read with `useSyncExternalStore` like `fanOutStore`; `AppSnackbar` rendered once in `app/_layout.tsx`); `useDeleteRecording` shows "Deleted" through it, then `router.back()`, and calls `removeQueries(['recording', id])` (not `invalidateQueries`, which refetches a 404).
- Title, tag and delete mutations also invalidate `['tags']`, so a new tag shows in the library chips and the chat scope bar.
- Tag duplicate check matches the server's `normalize_tag` (`backend/app/domain/tags.py`: trim, lower-case, whitespace → `-`, 24 characters).
- `usePlayer(recordingId: string, enabled: boolean)`: the audio source is created only while `enabled`; the page passes `enabled = recording?.status === 'ready' && !deleted`.
- "Couldn't load audio" (spec §6) never shows today: `usePlayer` waits for `playbackState === 'error'`, but on Android expo-audio 58.0.9 `playbackState` is only `ready`, `buffering`, `idle`, `ended` or `unknown`, and a load failure arrives as a `playbackStatusUpdate` with an `error` string (`AudioPlayer.kt` `onPlayerError`). Set the error from that field.
- Tests: a 500 shows the message and Retry, Retry refetches; a ready meeting with segments and an empty summary shows its transcript; after a successful delete "Deleted" shows on the app snackbar and `['recording', id]` is gone from the cache; adding a tag invalidates `['tags']`; adding "Work Notes" to a recording tagged "work-notes" sends no request; a `playbackStatusUpdate` with `error` shows "Couldn't load audio" and Retry.

**G. Library**
- A failed library Retry shows `errorMessage(error)` in a snackbar. One place catches the error (`LibraryScreen`), not both `LibraryScreen` and `PendingRow`.
- "No server" comes from `useServerUrl()`, not from matching `'server url'` in an error message.
- The list-enter stagger delay is capped (`Math.min(index, 8) * motion.staggerMs`): today a row far down the list waits `index × 30 ms` to appear when it scrolls in.
- `RecordingRow`'s prefetch uses the same query options as `useRecording` (one exported `recordingQuery(id)` with the `RecordingDetailOut` type and the no-retry-on-404 rule).
- Tests: a failed Retry shows the message; with no server URL set the no-server state shows whatever the error says; the stagger delay of row 20 equals that of row 8.

**H. Minor fixes** (each small; all in this task)
1. `FanOutOverlay.tsx` (443 lines) and `record.tsx` (433) are past ~400 lines: move `MicrophoneExplanation` to its own file; move the paused banner and the discard dialog out of `record.tsx`.
2. Remove the props only tests use: `RecordingHeader` `onUpdateTitle` / `onUpdateTags`, `TranscriptView` `onRenameSpeaker`, `HeaderMenu` `onDelete`; the tests drive the real mutations through a mocked `apiFetch`.
3. `usePlayer`: drop the `typeof player.x === 'function'` guards; "Couldn't load audio" only for a load failure; a failed seek or play is logged with `console.warn`.
4. `Waveform`: remove the leftover `level-placeholder` view; use Reanimated's `interpolateColor` instead of the hand-written hex parser.
5. Typed routes instead of route casts: `router.replace({ pathname: '/recording/[id]', params: { id } })` in `record.tsx` and `router.push` the same way in `RecordingRow` (no `as never` / `as unknown as Parameters<…>` on a route). The `as unknown as Blob` on the FormData file part in `upload.ts` stays: it is the React Native FormData boundary.
6. `HeaderMenu`'s haptic call gets the same `.catch` as the others.
7. One duration and date formatter in `src/format.ts` (today `record.tsx` writes `01:02:03` and `PendingRow` writes `1:02:03`; `RecordingRow` and `TranscriptView` import formatters from `PendingRow`). Use `H:MM:SS` past an hour.
8. Speaker colours use `tape.speaker[i % tape.speaker.length]`, not `% 6`.
9. `Scrubber`: while dragging, show the drag position and seek once on release (today every move event calls `seekTo`); add `accessibilityActions` increment and decrement (±5 s) to go with `accessibilityRole="adjustable"`.
10. Optimistic speaker rename: clearing a name does not invent a "Speaker X" label; keep the old `display_name` until the refetch.
11. Editing an untitled recording's title starts from an empty input with the "Untitled recording" placeholder, not with that text filled in.
12. During playback, a gap between segments keeps the last played segment highlighted instead of jumping back to the `?segment=` one.
13. `ProcessingTimeline`'s pulse uses `motion.durations.slow` for each half, not 600 ms.

- [ ] **Step 1: Merge** (part A) → checks clean → commit and push; then the `useTags` commit.
- [ ] **Step 2 (phone, Expo Go), before any part D change:** log `Constants.executionEnvironment` and `Constants.appOwnership` once when the recorder opens (temporary, not committed) and write both values in this task's issue. `executionEnvironment` not `storeClient` → parts D and E wait for the lead; the rest continues.
- [ ] **Step 3: Write the failing tests** for B–G as listed. **Step 4: Run** `npx jest` → FAIL. **Step 5: Implement** B–H, committing per part (`fix(mobile): …`). **Step 6: Run** jest, tsc, eslint, prettier → clean after each commit.
- [ ] **Step 7 (phone, Expo Go), results written in this task's issue:**
  - D: Meeting and Note both record with the fallback gone.
  - Task 4 Step 5: upload with Wi-Fi off → Retry shown; kill and reopen the app → "Not uploaded" row → Retry uploads; the new recording is in the library on return.
  - Task 8 Step 5: tap a summary citation → jumps and plays that moment; the transcript follows playback; "Couldn't load audio" + Retry with the server stopped.
  - Review Focus 3: background while recording → paused banner on return, nothing recorded until Resume; Resume continues the same file.
  - After the merge: with the server banner showing, open and cancel the fan-out from every tab (discs line up with the Record disc and take taps); the recorder's colour veil is not covered by the banner; the library's no-server state and the banner do not say the same thing twice (if they do, report it in the issue; do not change the banner).
  - A 30-minute meeting: the transcript scrolls and follows playback without visible stutter (if it stutters, report it in the issue).
  - Delete a recording → back in the library with "Deleted" shown, and no "This recording was deleted" flash during the back animation.
- [ ] **Step 8:** a final whole-branch review as `docs/implementing-plan-tasks.md` says, then fix the PR #68 description: "Not done, or done differently" lists anything left open, and "How it was tested" names the phone checks actually done.

### Task 10: Phone checks after Task 9

Tracked in #72: Task 9's Step 7 checks, run on the pushed branch against the processing plan's backend with `seed-demo` data.

### Task 11: Phone-report and review fixes

Follow-up from the lead's review of Task 9 (#69) and Stard-bch's phone reports on #38 and #39. (Task 10, #72, is the phone checks.)

**Files:**
- Modify: `mobile/src/library/LibraryScreen.tsx`, `mobile/app/_layout.tsx`, `mobile/src/recording/playability.ts`, `mobile/src/recording/pending.ts`
- Test: `mobile/src/library/LibraryScreen.test.tsx`, `mobile/src/recording/pending.test.ts`

**Fixes:**
1. **Library under the status bar.** On Android the Meetings and Notes search bar sits under the status bar (phone report on #38). Stard-bch's local `447da11` fixed it but was never pushed. It also changed pending-row search, which is not part of this task: drop `447da11` instead of pushing it. Wrap the library in `SafeAreaView` with `edges={['top', 'left', 'right']}`, as `ChatScreen` does (the tab bar handles the bottom).
2. **Back from a deep-linked recording leaves the app** (phone report on #39). In `app/_layout.tsx`, add `export const unstable_settings = { anchor: '(tabs)' };`, so a recording page opened directly has the tabs under it. This mirrors `(tabs)/_layout.tsx`'s `anchor: 'meetings'`.
3. **`playability.ts` swallows errors** in four empty `catch {}` blocks. AGENTS.md: no swallowed errors. Log each one with `console.warn` (a short reason plus the error). The results stay the same.
4. **`pending.ts` treats a folder as a file.** The `pendingDir.list()` filter is `(e): e is File => e instanceof File || 'name' in e`, and `Directory` has a `name` too. Use `e instanceof File` alone. The test mock already provides `File` as `MockFile`.

- [ ] **Step 1: Write the failing tests:**
  - the library's root is a `SafeAreaView` whose `edges` include `'top'` (with the jest mock the insets are 0; the real check is Step 5);
  - `listPending()` ignores a sub-folder named like a pending file (`<id>.meeting.m4a`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** 1–4. **Step 4: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 5 (phone, Expo Go):** the Meetings and Notes search bars are below the status bar; open `/recording/<id>` by deep link, press Back, and you land on Meetings.
- [ ] **Step 6: Commit** `fix(mobile): library safe area, root anchor and logged playability errors`.

### Task 12: Recording page keeps its data during an outage, and Retry shows progress

Follow-up from Stard-bch's phone checks on #72.

**Files:**
- Modify: `mobile/app/recording/[id].tsx`, `mobile/src/detail/useRecording.ts`
- Test: `mobile/src/detail/RecordingScreen.test.tsx`

**Fixes:**
1. **An open recording is replaced by the error screen when a refetch fails.** The page shows the full-page error whenever `error` is set, even with a recording already loaded. During an outage the transcript and player disappear, which is why the player's own "Couldn't load audio" could not be checked. Spec §6 says the app keeps the last loaded data during an outage, and the server banner already shows it. Show the full-page error only when there is no recording data (`error && !recording`). With data, keep rendering the recording.
2. **Retry gives no feedback.** `useRecording` also returns `isFetching`. While a Retry refetch runs, the Retry button shows its loading state (Paper `Button` `loading`, disabled) instead of looking stuck.

- [ ] **Step 1: Write the failing tests:**
  - a loaded recording whose refetch then fails still shows its title and transcript, not the error screen;
  - with no data and an error, the error screen shows; pressing Retry shows the button loading until the refetch settles.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 5 (phone):** open a recording, stop the backend. The recording stays on screen with the banner, and the player shows "Couldn't load audio" with Retry. On a recording that never loaded, Retry shows it is working.
- [ ] **Step 6: Commit** `fix(mobile): keep the recording on screen during an outage and show Retry progress`.

## Shared files with the chat-settings plan
This plan adds `FanOutOverlay` and the `record` screen options to `app/_layout.tsx`, and owns `app/recording/[id].tsx` (the Chat plan only navigates to it). The chat-settings plan edits `TabBar` (status dot) and `app/_layout.tsx` (theme preference, server banner). Whichever merges second brings the other in and keeps both; for this plan that is a merge commit (Task 9), not a rebase, because the branch has other people's commits.

## Self-review notes
- Spec coverage: UI §1 routes and back behaviour (Tasks 1, 2, 4, 6); §2 recording (Tasks 1–4); §3 libraries and recording page (Tasks 5–7); §4 tokens used throughout; §5 Tier 1 motion (Tasks 1, 3, 5, 6), Tier 2 (Task 8); §6 app-side failures for uploads, edits, playback, deleted citations (Tasks 4, 6, 7, 8). Chat and Settings are plan 5.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 needs 2; Task 4 needs 2; Task 5 needs 4 (pending rows); Task 6 needs 5; Task 7 needs 6; Task 8 needs 6. Tasks 3 and 4 can run in parallel, and so can Tasks 7 and 8.
- Task 9 (from the lead's review of PR #68) needs Tasks 1–8; it is one task because its parts touch the same files and part A must land first.
- Task 10 (#72, phone checks after Task 9) and Task 11 (phone-report and review fixes) both need Task 9 and can run in parallel.
- Task 12 (outage display and Retry progress) needs Task 9.
