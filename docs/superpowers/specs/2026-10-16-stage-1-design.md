# Stage 1 design: Core MVP

Status: written 2026-10-16 from sections 1–6 approved by the lead in the Phase 4 brainstorming. Awaiting the lead's review of this written spec.
Facts and decisions: `project_knowledge.md`. Stages and shared contracts: `docs/roadmap.md` (this spec follows them and does not restate them). The app name is never written here; it comes from `config/app.json`.

This spec is split into an overview (this file) and one file per area:

| File | Covers |
|---|---|
| `2026-10-16-stage-1-design-ui.md` | Screen map, navigation, recorder, visual direction, motion, app-side failure handling |
| `2026-10-16-stage-1-design-data-api.md` | Data model, REST API, error codes |
| `2026-10-16-stage-1-design-processing.md` | Processing pipeline, speech execution, analysis (Summarizer), chunking, indexing, processing failures |
| `2026-10-16-stage-1-design-chat.md` | Model registry and agent factory, Orchestrator, tools, citations, retrieval, Chat runs and failures |
| `2026-10-16-stage-1-design-platform.md` | Configuration, installs, security, testing, platform quirks |

## 1. Goal and success
Stage 1 delivers every must-have feature in `project_knowledge.md` on a real Android phone talking to the laptop. It is done when the roadmap walkthrough works for real: record a meeting and a note, see them processed, rename speakers, read the summary and the clean note, and ask Chat questions whose citations open the transcript line and play that moment.

## 2. Architecture

```
 Android phone (Expo app)                         Laptop (FastAPI backend, 127.0.0.1)
 ┌───────────────────────────┐   HTTPS via       ┌────────────────────────────────────────────┐
 │ Meetings · Notes · ● ·    │   tailscale serve │ REST /api/v1                                │
 │ Chat · Settings           │ ────────────────▶ │  ├─ recordings, speakers, tags, audio       │
 │ recorder, upload queue,   │   (private        │  ├─ chats + chat runs (polled)              │
 │ polling, player           │    tailnet)       │  └─ health                                  │
 └───────────────────────────┘                   │ Processing worker (one recording at a time) │
                                                 │  decode → transcribe* → diarize* (meetings) │
                                                 │  → analyze (Summarizer) → index             │
                                                 │  * child processes, one model on the GPU    │
                                                 │ Chat: LangGraph graph (Orchestrator agent,  │
                                                 │  tools, Summarizer agent, citation check)   │
                                                 │ Model registry + agent factory (failover)   │
                                                 │ SQLite + sqlite-vec · audio files (data dir)│
                                                 └──────────────┬─────────────────────────────┘
                                                                │ HTTPS
                                                 Groq / Gemini free tiers (OpenAI-compatible)
```

Backend components (each a package under `backend/app/`; exact file layout is set by the plans):
- `config`: settings (env + `config/app.json` + `config/models.yaml`), data dir and model cache dir.
- `db`: SQLite connection, numbered migrations, repositories.
- `api`: FastAPI routers, request/response models (the source of `backend/openapi.json`), error handlers.
- `audio`: decode (PyAV) to 16 kHz mono float32, waveform peaks, file storage, Range serving.
- `speech`: ASR and diarizer interfaces, real implementations run as child processes, fakes.
- `processing`: the worker, the step pipeline, claim/resume/retry rules.
- `llm`: the model registry and the agent factory (failover, retry, limits) used by every agent.
- `agents`: Summarizer and Orchestrator definitions, prompts (`backend/app/agents/prompts/`), the Chat graph, tools, source registry, citation check.
- `rag`: chunker, embedder wrapper, retrieval query.

Mobile components (Expo SDK 58, expo-router):
- routes: tabs (Meetings, Notes, Chat, Settings) with a custom tab bar and the centred record action; recorder; recording detail.
- `api`: generated types from `backend/openapi.json`, a typed client, TanStack Query hooks.
- `recording`: recorder, live waveform, upload queue (pending files on the phone).
- `theme`: tokens, Paper theme, fonts, motion constants.

## 3. Data flow

Recording to ready:
1. Tap ●, choose Meeting or Note; recording starts as the transition ends (UI file).
2. Stop: the file moves to the app's document directory; upload `POST /api/v1/recordings` with `kind`, `client_upload_id`, file. Progress ring from XMLHttpRequest upload progress.
3. The server saves the file, creates the recording (`uploaded`) and returns it; the app opens its detail and polls.
4. The worker claims it and runs: decode (+ `waveform_peaks`) → `transcribing` → `diarizing` (meetings) → `analyzing` → `indexing` → `ready` (processing file).
5. The app shows each step live; on `ready` the summary or note animates in.

Chat question:
1. `POST /api/v1/chats/{chat_id}/messages` with text, scope and tag filter → the user message id, which is also the run id.
2. The server runs the Chat graph in the background; tools write status lines.
3. The app polls `GET /api/v1/chats/{chat_id}/runs/{run_id}` every 500 ms, showing the steps, then the answer with citations (chat file).

## 4. Decisions index (where each roadmap question is answered)
| Roadmap question | Answer |
|---|---|
| Agent design | Chat file §2–§4 |
| Prompts and structured output schemas | Processing file §4, chat file §3 |
| Chunking | Processing file §5 |
| Failure behaviour | UI file §6, processing file §6, chat file §6 |
| Speaker renaming | Data-API file §1, processing file §4 |
| Consent | No consent screen or notice (lead decision) |
| Screen map and navigation | UI file §1–§3 |
| Light model picks | Platform file §1 |
| Tags | Processing file §4, data-API file §1 |
| The two installs | Platform file §2 |
| LLM fallback for tool-calling agents | Chat file §1 |
| ASR / diarization subprocesses | Processing file §2 |

## 5. Out of scope for stage 1
Stage 2 items (action-item checklist, share/export, note editing, pin/favourite, saved chat history UI), live transcript, iOS build, keyword search and re-ranking, rate-limit modelling (failover handles provider limits), a consent screen.

## 6. Known limits
- Exact names and numbers in Chat rely on semantic search (no keyword search).
- A segment that spans a speaker change is attributed to the speaker with the most overlap.
- In Expo Go, recording pauses when the app leaves the foreground; the EAS APK records in the background.
- Chat answers already written keep the speaker names they were written with.
- The relevance cut-off starts permissive and is calibrated on the demo recordings (a plan task).
