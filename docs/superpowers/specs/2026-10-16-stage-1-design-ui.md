# Stage 1 design: mobile UI

Part of the stage 1 spec (overview: `2026-10-16-stage-1-design.md`). Approved in section 1 (screen map, look, motion) and section 5 (failure handling) of the brainstorming.

User requirements [USER]: polished, not AI-generated; the recording moment is "epic and snappy"; the UI is dynamic, meaning live and state-driven (voice level, processing progress, playback position, agent steps).

## 1. Navigation
Custom bottom bar: **Meetings · Notes · ● · Chat · Settings**. Five slots, symmetric. The ● is an action, not a tab: a 64 dp disc in the signal colour, raised above the bar, reachable from every tab. Tabs have icon + label and a highlighted active state. Settings carries a live server-status dot (connected / unreachable).

Routes (expo-router): `(tabs)/meetings`, `(tabs)/notes`, `(tabs)/chat`, `(tabs)/settings`, `record` (full-screen, no default modal animation), `recording/[id]` with optional `?segment=<seg_id>`. Back from a recording opened after an upload goes to the list, never into the recorder (`router.replace`).

## 2. Recording
1. Tap ●: check microphone permission first. Missing → OS dialog; denied → a sheet explaining why with "Open Settings". No animation runs before permission is granted.
2. With permission: light haptic; two labelled discs spring up from the ●: **Meeting** (left) and **Note** (right), in fixed positions on every tab. The ● becomes ✕; tapping ✕ or outside cancels.
3. Tap one: heavy haptic; that disc scales to fill the screen (Reanimated overlay, spring ≈ 280 ms) while `prepareToRecordAsync()` runs underneath; recording starts as the transition ends. The kind is shown at the top and is fixed for that recording. No consent screen or notice [USER].
4. While recording:
   - waveform of ≈ 48 bars scrolling right to left, the newest in the signal colour, older ones fading to ink-muted; drawn with Reanimated `Animated.View`s (no Skia);
   - a ring around the Stop disc breathes with the current level;
   - timer in IBM Plex Mono, tabular digits; the screen is kept awake.
   - Levels: recorder created with `isMeteringEnabled: true`; the status listener of `useAudioRecorder` (polling ≈ 50 ms) writes into a shared value; dBFS clamped to −50…0 and mapped to 0…1. Not `useAudioRecorderState` (it would re-render the screen 20×/s).
5. Stop: medium haptic; the file moves to the document directory; the ring becomes the upload progress ring (XMLHttpRequest `upload.onprogress`, multipart FormData); on success a check mark, then the screen turns into `recording/[id]`. Failure: Retry on the ring (section 6).
6. ✕ or Android back while recording asks "Discard recording?".
7. Background: in the EAS APK recording continues with Android's ongoing notification; in Expo Go it pauses and the recorder shows "Paused while the app was in the background" with Resume / Stop, plus a quiet line "Keep the app open while recording" (platform file §5).
8. Reduce motion: the waveform becomes a single level bar; no spring scale-up, a fade instead.

## 3. Screens
**Meetings / Notes (libraries).**
- Search bar (matches title, tags and transcript text); before typing it shows existing tags as suggestions.
- Tag chips filter the list.
- Rows: title, date, duration, tags, waveform thumbnail (Tier 2), status. A recording that is processing shows its current step and a thin progress line. "Not uploaded" rows (pending uploads) sit on top with Retry and Delete.
- Empty states with an action: no server set → Open Settings; nothing yet → Record; no matches → Clear filters.
- Scroll position, search text and filters are restored when coming back.

**Recording detail `recording/[id]`.**
- Processing: vertical step timeline (uploaded, transcribing, diarizing for meetings, analyzing, indexing) with the current step animated and a status line. Failed: a human message for the error code and Retry.
- Ready meeting: editable title and tag chips, then a segmented button **Summary | Transcript** (no horizontal swipe).
  - Summary: overview, decisions, action items (owner and due date when present), open questions; each item has citation chips.
  - Transcript: consecutive segments of one speaker shown as one turn with a timestamp; speaker chips above the transcript; tapping a chip or a speaker name opens the rename dialog (optimistic).
- Ready note: title, tags, key points (cited), clean note, and a Transcript view one tap away.
- Player bar fixed at the bottom; content is inset so nothing hides behind it or the gesture bar. Tapping a citation or timestamp scrolls to the segment, highlights it and plays from `start_ms`. `?segment=` does the same on open.
- ⋮ menu: Delete, in red and set apart; confirm, then a "Deleted" snackbar. While this recording is being processed, Delete is disabled with "Available when processing finishes".
- A citation to a deleted recording opens a "This recording was deleted" state.

**Chat.**
- Top: scope selector (Notes / Meetings / Both) and tag chips. Empty chat: 3–4 starter questions. Until a recording is ready: an explanation and a Record button.
- While a run is going: a live status line from the run's steps ("Searching meetings… Found 6 passages… Writing answer…").
- Answers show numbered citation chips (recording title + time); tapping one opens `recording/[id]?segment=…`. Fixed replies for greeting, help (with the starter questions), out-of-scope, and "Not in your recordings."
- "New chat" starts a new chat. The current chat survives switching tabs while the app is open.

**Settings.** Server URL with Test connection (reports unreachable / not HTTPS / not this server), theme (System / Light / Dark), readiness per role from `/health` (e.g. "Speech: fake (dev)", missing keys), app name and version from config.

**Everywhere.** "Can't reach the server" banner with a Settings link; skeletons while loading; all touch targets ≥ 48 dp with ripple feedback.

## 4. Visual direction: "Tape"
A studio instrument, not a chatbot. Typography-led, one saturated colour, monospace numbers.
- Tokens (semantic, both themes from the same names):
  - dark: bg `#121110`, surface `#1C1A18`, raised `#26231F`, ink `#F2EDE4`, ink-muted `#A39B90`, line `#34302B` (decorative only), outline `#6E665C`, signal `#FF4D2E`, on-signal `#121110`.
  - light: bg `#F6F3EE`, surface `#FFFFFF`, ink `#161412`, ink-muted `#6B645B`, line `#E3DDD3` (decorative only), outline `#8C8378`, signal `#C4351A`, on-signal `#FFFFFF`.
  - speaker hues, dark: clay `#D98A6C`, sage `#8FB394`, slate `#8EA4C8`, ochre `#D4B05E`, plum `#C495C0`, teal `#6FB8B0`; light: `#A4532F`, `#48724F`, `#4A6694`, `#8A6A12`, `#87507F`, `#2F7A72`.
  - Contrast checked with a WCAG script: all text pairs ≥ 4.5:1 on bg and surface; outlines and speaker hues ≥ 3:1 (speaker hues ≥ 4.5:1, so they can colour names).
- Type: IBM Plex Sans (400, 600) for UI; IBM Plex Mono (500) for timer, timestamps, durations, counts; at most 4 sizes. Loaded with `@expo-google-fonts` packages and expo-font.
- Shape: radius 10 on cards and sheets; full round only for the record disc and chips; hairlines instead of shadows; 8 dp grid.
- Icons: MaterialCommunityIcons outline set (bundled with Paper).
- React Native Paper 5 with a custom MD3 theme built from the tokens, used for dialogs, menus, snackbars and inputs. Custom components: tab bar, record disc and fan-out, recorder, waveform, transcript, step timeline, player.
- Never: gradients, glassmorphism, sparkle icons for AI, purple/blue defaults, emoji, pill-everything, marketing copy. Plain words: "Record", "Ask", "Summary".

## 5. Motion and dynamic behaviour
Tier 1 (stage 1, must work in the demo): the record fan-out and transition with haptics; live waveform and level ring; upload ring; live processing steps in rows and detail; staggered reveal when a recording becomes ready; both themes; press springs (scale 0.97); list enter (fade + 8 dp rise, 30 ms stagger); layout transitions on filter/search; haptics on start, stop, rename, delete; reduced motion respected (`useReducedMotion`); optimistic title/tag/speaker edits; skeletons; prefetch the detail on press-in. Durations 150–280 ms.

Tier 2 (polish; built after Tier 1 tasks and cut first if time runs short, stated in the plan issue if cut): waveform thumbnails from `waveform_peaks` in list rows; player scrubber over the peaks with drag-to-seek; karaoke follow (the playing segment highlighted and auto-scrolled; manual scroll pauses follow until "Follow" is tapped).

## 6. App-side failure handling
- Upload fails or is interrupted: the file and its kind stay on the phone; Retry on the recorder; afterwards a "Not uploaded" row (survives app restarts; pending files are listed from the document directory with a small index in AsyncStorage). `client_upload_id` makes retries idempotent.
- Recorder error mid-recording: stop; if the file is playable, offer Save / Discard, else say it failed.
- Server unreachable (network error or 10 s timeout): banner; a health check every 10 s while it shows; lists keep the last loaded data (in-memory TanStack Query cache). Queries retry twice with backoff; mutations do not retry.
- Optimistic edits roll back with "Couldn't save"; delete failure shows a snackbar and keeps the item.
- Playback load failure: "Couldn't load audio" + Retry.
- Processing failure: message per error code + Retry (`POST …/retry`).
- Chat run failure: message per error code + Retry (re-runs the stored question); the app stops polling after 90 s as a backstop to the server's 75 s deadline; a run that no longer exists (server restart) shows "Interrupted" + Retry.
- Every API error code maps to a message (codes are a closed list in `openapi.json`); unknown codes show the server's message.
