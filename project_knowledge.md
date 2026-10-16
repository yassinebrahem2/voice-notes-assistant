# Project Knowledge File: Voxa (working name)

Current state of the project, rewritten 2026-10-16. Sections: brief, decided, open, ideas, changed, files.
Sources: [BRIEF] the brief (`project_context.md`). [USER] stated by the user. [AGREED] proposed by Claude and explicitly accepted by the user.
Anything not listed here is unknown.

## 1. Brief [BRIEF]
- Title: Meeting & Voice Notes Assistant. Working name Voxa (placeholder, can be changed).
- Goal: a mobile app that records audio from meetings, conversations, or a single person talking and brainstorming. Recordings are transcribed and saved. The user can tag them, ask questions about them in natural language, and get summaries of meetings and conversations.
- Problem: spoken information (decisions, ideas, action items) gets lost because recordings are rarely re-listened to and transcripts are unorganized. The app makes that audio searchable and queryable.
- Deadline: Tuesday 2026-10-20, a demo to the professor. [USER]
- Done for now: a working end-to-end system on a real Android phone. It does not need to be perfect, but it must look polished and high quality, UX-wise and feature-wise. [USER]

## 2. Decided

### Product and users
- [USER] Single user, no accounts.
- [USER] Recordings are in English.
- [USER] The app name is not settled and must be configurable from one place.
- [USER] Three sections: **Meetings** (several people; diarization is crucial), **Notes** (voice note-taking, a different thing from meetings), **Chat** (a chatbot set to answer about notes, meetings, or both).
- [AGREED] Recording happens live on the phone; on stop, the audio is uploaded and processed on the laptop. No live transcript.
- [AGREED] Feature list. M = must-have for 2026-10-20, built first. S = in scope at lower priority. [USER] No onboarding; everything else is in.
  - **Meetings.** M: record screen with timer, then a processing status that updates per step; transcript as speaker turns with timestamps; rename speakers, applied everywhere; auto-title and editable auto-tags; structured summary (decisions / action items / open questions). S: action items as a checklist; share or export the summary.
  - **Notes.** M: one-tap record, no diarization; the LLM turns the speech into a clean note (title, key points) with the raw transcript one tap away; tags. S: edit the note's text; pin or favorite.
  - **Playback.** M: audio plays in the recording view; tapping a citation plays from that moment. [USER]
  - **Chat.** M: scope selector (Notes / Meetings / Both) plus optional tag filter; answers cite sources, and tapping a citation opens that transcript line; "not in your recordings" when nothing matches; suggested starter questions. S: saved chat history.
  - **Everywhere.** M: library with search and tag filter; empty, loading and error states; delete a recording; consistent visual design with dark mode; server URL in Settings.
- [BRIEF] Summaries are structured as decisions / action items / open questions; answers are grounded in stored transcripts and cite recording and moment.

### Architecture
- [USER] Multi-agent and RAG are requirements.
- [USER] The laptop is the server: it hosts the backend, transcription, diarization and storage. The phone is the client.
- [USER] LLMs are always hosted (free options), never self-hosted. Embedders may run on the laptop or be hosted.
- [USER] Light models.
- [USER] No automation platform. Everything is code.
- [USER] The transcription and diarization approach comes from `yassinebrahem2/live-debate-analysis` (faster-whisper + pyannote `speaker-diarization-community-1`, batch over files, benchmarked on a Windows laptop with a 6 GB RTX 4050).
- [BRIEF] Transcription, tagging and retrieval are deterministic workflows, not agents. Only the reasoning parts are agents.
- [BRIEF] RAG: transcripts are chunked, embedded and stored in a vector store; questions retrieve relevant chunks first.

### Data
- [AGREED] Everything lives on the laptop: recordings, audio files, transcripts, tags, summaries, the vector index. The phone keeps only its settings (server URL).
- [USER] Audio is kept until the user deletes the recording.

### Models
- [AGREED] One model configuration file, following the design (not the code) of `multimodal-rag-agent`'s registry, keys only in environment variables (details under Tech stack).
- [USER] The app name lives in its own single config value.

### Mobile
- [USER] React Native. Android is the target (APK).
- [USER] No Android Studio or Android SDK installs.

### UI (stage 1 spec, section 1, approved 2026-10-16)
- [USER] The design must look polished and not AI-generated; the recording moment must feel "epic and snappy"; the UI is dynamic (live, state-driven: recording level, processing progress, playback position, agent work).
- [AGREED] Navigation: custom tab bar Meetings · Notes · ● · Chat · Settings; the centred ● is a record action, not a tab.
- [USER] Recording asks the kind first: tap ●, choose Meeting or Note, recording starts as the full-screen transition ends. Live waveform while recording.
- [USER] No consent screen or notice before a meeting recording.
- [AGREED] Visual direction "Tape": warm near-black / paper themes, one red-orange signal colour, IBM Plex Sans + Plex Mono, no gradients, glass, sparkle icons or emoji. React Native Paper re-themed for dialogs, menus and inputs; signature pieces are custom.
- [AGREED] UI design skills `ui-ux-pro-max` and `mobile-app-ui-design` are vendored in `.claude/skills/`.

### Deployment
- [USER] The phone reaches the laptop through a tunnel. The server URL is configurable in the app.
- [AGREED] Tailscale as the tunnel; `tailscale serve` gives the laptop an HTTPS address (Android release builds block plain `http://`). Nothing is exposed publicly.

### Tech stack [AGREED]
Versions checked 2026-10-16; majors are pinned.
- Backend: Python 3.12, FastAPI 0.143, uv. One background worker processes recordings one at a time (the 6 GB GPU holds one model at a time).
- Storage: SQLite with sqlite-vec 0.1.9 (vectors in the same file, exact search). Fallback if extensions cannot load: LanceDB 0.40.
- Embedder: fastembed 0.9, `BAAI/bge-small-en-v1.5`, local on CPU.
- Speech: faster-whisper 1.2.1 (`distil-large-v3`); pyannote.audio 4.0.7 `speaker-diarization-community-1` for meetings only (needs `HF_TOKEN`). Speech dependencies are an optional install group; ASR and diarizer sit behind interfaces with fakes, so CI never installs torch or needs a token.
- LLMs: Groq free tier first, Gemini free tier as fallback (OpenAI-compatible endpoints).
- Agents: LangGraph 1.2 with LangChain 1.4 (1.x APIs such as `create_agent`; LangChain's model fallback for the LLM role, exact mechanism in the stage 1 spec). Not `langgraph-supervisor` (pre-1.0).
- Model config: one `models.yaml` with providers (`base_url`, `key_env`) and models by role (`llm`, `embedder`, `asr`, `diarizer`), each hosted (provider + model id) or local (model id, device, precision); the LLM role has a fallback order; code asks for a role, never a model name.
- Mobile: Expo SDK 58, expo-router, expo-audio, expo-keep-awake, TanStack Query 5, React Native Paper 5 (Material 3, dark mode). React Native version chosen by `npx expo install`.
- Development on phones in Expo Go; the demo APK is built with EAS Build (cloud, free tier: 15 Android builds/month, low-priority queue with possible 90+ minute waits), by Monday 2026-10-19. Expo Go is the demo fallback.

### Prompting [BRIEF]
- Structured output for summaries.
- Guardrails: answers rely only on retrieved transcript content; the model does not invent what was not said.

### Process
- [USER] Team of 4. Lead: GitHub `yassinebrahem2`. Coding agents: Codex, Claude Code, Antigravity.
- [USER] Work follows `new-project-playbook.md`. Repo setup, roadmap and infrastructure are done on 2026-10-16; the following days are for building.
- [USER] `main` is the integration branch, with `plan/*` branches per the playbook.
- [USER] Stage 1 may cover every M feature, provided it is split into several plans when too big for one (playbook rule).
- [USER] Project board: https://github.com/users/yassinebrahem2/projects/6.
- [BRIEF] The coding assistant asks before choosing the stack for any open item.

## 3. Open
Each item is safe to decide later; the stage that decides it is named.
- **Agent design**: which agents exist and how they hand off. Stage 1 spec.
- **Failure behaviour** per step (processing, LLM, network). Stage 1 spec.
- **Chunking strategy**: a config choice; a comparison is not in scope for 2026-10-20. Stage 1 spec. [BRIEF]
- **Privacy**: free LLM tiers (Gemini) may use inputs for training. Stage 1 spec. [BRIEF] (Recording consent: decided, no consent screen.)
- **iOS**: works in Expo Go as a bonus (no custom native code); a standalone iOS build needs a paid Apple Developer account. Awaiting the user's yes. Roadmap.
- **Initial light model picks** within the stack (e.g. Whisper size) are config edits, not design decisions.

## 4. Ideas
- Live transcript while recording (user: "we'll see if we can reach it later").
- Standalone iOS build (needs an Apple Developer account).

## 5. Changed
- Upload audio and transcribe on the server (brief) → transcription and diarization on the phone (2026-10-16, user) → recording on the phone, transcription and diarization on the laptop (2026-10-16, user: on-device models need a native build).
- iPhone first via Expo Go, Android later (2026-10-16, user) → Android as the target (2026-10-16, user); iOS in Expo Go under Open.
- PydanticAI as the agent framework (proposed) → LangGraph (2026-10-16, agreed: better known by the team's coding agents, built-in model fallback, diagram for the demo).
- Pre-build checks on the laptop (proposed) → skipped; fallbacks documented instead (2026-10-16, user).
- Server deployed in the cloud (2026-10-16, user) → hosted on the laptop, reached through a tunnel (2026-10-16, user).
- "Never locally hosted" for all models → LLMs never self-hosted; embedders may be local (2026-10-16, user).
- Audio stored temporarily until transcribed (2026-10-16, user) → kept until the user deletes it (2026-10-16, user: citations can play the moment back).
- Live recording with live transcript (2026-10-16, user) → record live, process on stop; live transcript moved to Ideas (2026-10-16, user).
- Timestamps and speaker labels "desirable, not decided" (brief) → diarization is in and provides timestamps (2026-10-16, user).
- Automation platform vs. custom backend open (brief) → all code (2026-10-16, user).

## 6. Files
- `project_knowledge.md`: this file.
- `project_context.md`: the original idea file, kept unchanged as the source of [BRIEF].
- `new-project-playbook.md`: how the work is run.
- `docs/roadmap.md`: stages and shared contracts (Phase 2).
