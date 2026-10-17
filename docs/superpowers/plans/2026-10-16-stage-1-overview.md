# Stage 1 overview: Core MVP

Shared by every stage 1 plan. Each plan links here instead of repeating it.
Spec: `docs/superpowers/specs/2026-10-16-stage-1-design.md` (and its five area files). Contracts: `docs/roadmap.md`. Rules: `AGENTS.md`.

## Goal
Every must-have feature working end to end on a real Android phone talking to the laptop, ready for the demo on Tuesday 2026-10-20.

## Global constraints
- Python 3.12, uv, FastAPI 0.143, Pydantic 2, sqlite-vec 0.1.9, fastembed 0.9, faster-whisper 1.2.1, pyannote.audio 4.0.7, LangGraph 1.2, LangChain 1.4. Majors pinned; a major upgrade is a separate decision.
- Expo SDK 58, expo-router, expo-audio, TanStack Query 5, React Native Paper 5. Native packages only through `npx expo install`; no custom native code; must run in Expo Go.
- ruff (lint + format) and pyright strict must pass; TypeScript strict, ESLint and Prettier must pass; no `any`.
- The app name is read from `config/app.json` only. Models are chosen only in `config/models.yaml`, by role (`llm`, `llm_analysis`, `embedder`, `asr`, `diarizer`).
- Secrets only in env vars (`backend/.env`); never in config, URLs, logs, errors, reprs or fixtures.
- Runtime data (database, audio, model caches) outside the repository.
- The schema is migration `001` from the foundation. Stage 1 plans do not add migrations; a plan that needs a schema change opens a Decision issue.
- `backend/openapi.json` and the generated mobile types change only with an API change, regenerated together.
- Scaffolding CLIs run with their non-interactive flags; no dev server left running at the end of a task.
- Conventional Commits; no AI attribution.

## Review focus (the inputs most likely to hurt a real user)
1. An upload that drops halfway, then is retried (no duplicate, nothing half-saved).
2. A recording deleted or retried while the worker is on it.
3. A silent or ten-second recording (no failed analysis, no invented content).
4. Chat questions with nothing relevant, or that the agent cannot finish (fixed replies, never a hang or a raw error).
5. The phone losing the server mid-use (banner, cached data, rollback of optimistic edits).

## File ownership
- Foundation owns: `backend/` project files, `app/config`, `app/db` (and migration `001`), `app/api` (app factory, errors, models, routers), the protocols and fakes, `app/container.py`, `app/cli.py`, CI workflows; `mobile/` scaffold, `mobile/app/_layout.tsx`, `mobile/app/(tabs)/_layout.tsx`, theme, API client and generated types.
- Feature plans fill in their routers' handlers and add files in their own packages; they edit a foundation file only where their plan names it.
- Route ownership: processing owns every recordings and tags route (upload, list and search, detail, PATCH title and tags, speaker rename, delete, retry, audio, `GET /tags`), with the read endpoints first so mobile can use real data early; agents owns the chats and runs routes.
- Analysis split: agents owns the `Analyzer` (prompts, failover walk, map-reduce); processing owns the post-processing of its output (S numbers to citations, owner to `speaker_id`, speaker tokens, tag reuse) using `app.domain.speakers` and `app.domain.tags` from the foundation.

## Plans
| # | Plan | Branch | Depends on | State |
|---|---|---|---|---|
| 1 | Foundation: backend skeleton, schema, all routes and models, openapi.json, protocols and fakes, mobile scaffold, theme, API client, CI, Tailscale setup, throwaway APK; Task 8 shared backend helpers and demo seed; Task 9 mobile error messages and record menu store | `plan/stage-1-foundation` | none | merged (#1, PR #9) |
| 2 | Processing: upload, audio and Range, worker (claim, resume, retry, delete), speech child processes, chunking and indexing, laptop setup command | `plan/stage-1-processing` | 1 | issue #17: `2026-10-17-stage-1-processing.md` |
| 3 | Agents: registry and agent factory, Summarizer, Orchestrator and tools, retrieval, Chat runs, provider smoke test, relevance calibration | `plan/stage-1-agents` | 1 | issue #18: `2026-10-17-stage-1-agents.md` |
| 4 | Mobile recording: record fan-out and recorder, waveform, upload queue, libraries, recording detail, player, Tier 2 polish | `plan/stage-1-mobile-recording` | 1 | issue #19: `2026-10-17-stage-1-mobile-recording.md` |
| 5 | Mobile Chat and Settings: Chat screen, Settings, server banner, error messages | `plan/stage-1-mobile-chat-settings` | 1 | issue #20: `2026-10-17-stage-1-mobile-chat-settings.md` |

After plans 2–5 merge, the lead runs the demo checklist (spec platform file §4) on the phone.
