# Roadmap

Stages and the shared contracts every stage follows. A change to a contract is made here first.
Facts about the project live in `project_knowledge.md`; this file only orders the work and fixes the rules.

## Timeline

| Day | Date | Work |
|---|---|---|
| Fri | 2026-10-16 | Roadmap, repo setup, stage 1 spec and plans, issues |
| Sat | 2026-10-17 | Morning: backend route skeleton + `openapi.json` and mobile scaffold merged, so every plan builds on them. A throwaway EAS APK build right after the mobile scaffold, to surface build problems early |
| Sat–Mon | 2026-10-17 → 19 | Build stage 1, then stage 2. Demo APK built with EAS by Monday morning |
| Tue | 2026-10-20 | Demo to the professor. Fixes only, no features |

## Stages

### Stage 1: Core MVP (every M feature)

The four-person team needs parallel work from day one, so stage 1 is the whole must-have feature set. As the playbook requires for a stage too big for one plan, it is split into several plans, each small enough to review and assign on its own, running in parallel against the contracts below. It is done when the demo walkthrough works for real on an Android phone talking to the laptop: record a meeting and a note, see them processed, rename speakers, read the summary and the clean note, and ask Chat questions with citations that open the transcript line.

Agreed for stage 1:
- Everything marked M in `project_knowledge.md` (Meetings, Notes, Chat, everywhere).
- Backend: FastAPI app, config loading (app name, models file), SQLite + sqlite-vec, processing worker, REST API.
- Speech: faster-whisper ASR for all recordings; pyannote diarization for meetings.
- Analysis: auto-title, auto-tags, meeting summary, clean note.
- RAG: chunking, embedding, retrieval with filters (kind, tags).
- Agents: the Chat multi-agent system on LangGraph, with grounded, cited answers.
- Mobile: Expo app with the three sections, library, recording detail, settings, theme with dark mode.
- Tooling: one-command install per side (the laptop and dev/CI installs differ; see questions), lint, type checks, tests, CI. The backend install also downloads the models, so nothing downloads during the demo.
- Setup doc: Tailscale (MagicDNS and HTTPS certificates enabled in the admin console), Hugging Face token with the pyannote model terms accepted, `.env` keys.

Questions the stage 1 spec must answer:
- Agent design: which agents exist (orchestrator, retrieval, summarizer, others), what each may call, how they hand off, and the graph.
- Prompts and structured output schemas: meeting summary, clean note, title and tags, answer with citations.
- Chunking: the default strategy (by speaker turn for meetings, by window for notes, or one rule) and its parameters.
- Failure behaviour per processing step, per LLM call (rate limit, fallback exhausted), and on the network (upload interrupted, server unreachable).
- Speaker renaming: where names are stored and how they reach transcripts, summaries and answers already written.
- Consent: what the app shows before a meeting recording.
- The screen map and navigation (after usage, per the playbook).
- Exact light model picks in `config/models.yaml`.
- Tags: free-form, or typed by the brief's categories (topic, project, meeting type); how the LLM reuses existing tags to avoid near-duplicates.
- The two installs: the laptop install (speech extras, model downloads) and the dev/CI install (fakes, no torch), each one command.
- The LLM fallback mechanism for tool-calling agents (e.g. LangChain 1.x agent middleware vs. `with_fallbacks`, which may not expose `bind_tools`).
- Whether ASR and diarization each run in a subprocess (as tested in `live-debate-analysis`), which also frees GPU memory between steps.

### Stage 2: Stretch and polish (S features)

Built after stage 1 is merged, as time allows before Monday evening: action items as a checklist; share or export a summary; edit a note's text; pin or favorite; saved chat history; visual polish found while rehearsing the demo.

Questions its spec must answer: which S items fit the remaining time, in what order.

### Later (not before 2026-10-20)

Live transcript while recording; standalone iOS build; anything in `project_knowledge.md` § Ideas.

## Shared contracts

### Repository layout
```
backend/     Python service (FastAPI, worker, speech, RAG, agents)
mobile/      Expo app
config/      app.json (name and branding), models.yaml (models by role)
docs/        roadmap, specs, plans
```
Runtime data lives outside the repository (see Data layout).

### Run mode and security
- One run mode: the server runs on the laptop; the phone is the client.
- The server binds to `127.0.0.1` by default (the bind host is a setting). The phone reaches it through `tailscale serve`, which gives an HTTPS address on the private tailnet. Nothing is exposed on the LAN or the internet.
- No accounts and no app-level auth: the tailnet is the boundary.
- The server URL is a setting in the app, stored on the phone. It is the only thing the phone stores apart from UI preferences.

### Configuration: one place per concern
- `config/app.json`: the app name and branding values. Read by the backend and by the Expo config (`mobile/app.config.ts`), which passes them to the app through `extra` (read with `expo-constants`). App code never imports from `../config/`. No other file hard-codes the name.
- `config/models.yaml`: providers (`base_url`, `key_env`) and models by role (`llm` for Chat, `llm_analysis` for processing, `embedder`, `asr`, `diarizer`), hosted or local; each LLM role has an ordered failover list (configurable). Code asks for a role, never a model name.
- Secrets live only in environment variables, loaded from `backend/.env` (git-ignored). `models.yaml` names the variable (`key_env`); it never holds a key. A `base_url` with credentials in it is refused at load.
- `backend/.env.example` lists every variable with no values.

### Data layout (laptop)
```
<data dir>/
  app.db                       SQLite: all records and the vector index (sqlite-vec)
  audio/<recording_id>.<ext>   original audio, deleted with its recording
<model cache dir>/             Hugging Face and fastembed caches (several GB)
```
- The data dir defaults to the per-user app-data directory (`platformdirs.user_data_dir`, named from `config/app.json`), outside the checkout, so no git command (e.g. `git clean -x`) can reach it. It is a backend setting.
- The model cache dir is a separate setting, so it can sit on whichever drive has space. The setup doc states the disk space needed.
- Deleting a recording deletes its rows, its vectors and its audio file in one operation.

### IDs
- Prefixed random IDs: `rec_` recording, `seg_` transcript segment, `spk_` speaker, `chk_` chunk, `tag_` tag, `cht_` chat, `msg_` chat message. Format: prefix + 26-character ULID.
- IDs are opaque to the app; it never parses them.

### Domain shapes (names fixed here; fields in the stage 1 spec)
- Recording: `kind` is `meeting` or `note`. Has a title, tags, created time, duration, processing status, and `waveform_peaks` (a short list of peak levels from 0 to 1, computed by the backend when it decodes the audio; null until then), used for the waveform thumbnail and the player's seek bar.
- Segment: one ASR segment (a few seconds, at most about 30 s) for both kinds: `start_ms`, `end_ms`, `speaker_id` (meetings only), text. The app shows consecutive same-speaker segments as one turn.
- Speaker: per recording; diarizer label plus an optional user-given name.
- Times are milliseconds from the start of the recording; wall-clock times are UTC ISO 8601.

### Processing lifecycle
`uploaded → transcribing → diarizing (meetings only) → analyzing → indexing → ready`, or `failed` with an error code and message from any step. The app polls the recording's status. One worker processes one recording at a time (one model on the GPU at a time).
- On server startup, every recording in a non-terminal status is re-queued from the start of its pipeline (the laptop may sleep or restart mid-job).
- A `failed` recording can be retried through the API.

### Audio
- The app uploads what expo-audio records (compressed, e.g. m4a). The backend keeps that file as the original.
- For processing, the backend decodes it once to 16 kHz mono float32 and passes that in-memory waveform to both ASR and diarization. pyannote is never handed a file path.
- Audio is served back with HTTP Range support, so the app can play from a given moment (playback is a must-have).

### Speech dependencies
- Speech models (torch, faster-whisper, pyannote) are an optional install group, with torch pinned to the CUDA (cu128) package index as in `live-debate-analysis`; PyPI's torch is CPU-only.
- Windows-specific CUDA library loading is a platform shim that runs only on Windows.
- ASR and diarization sit behind interfaces with fakes; CI never installs torch and never needs a Hugging Face token.

### API
- REST + JSON under `/api/v1`, snake_case fields.
- Errors: HTTP status plus `{"error": {"code": "<snake_case>", "message": "<human text>"}}`.
- The backend's Pydantic models are the source of truth. The exported schema is committed as `backend/openapi.json`; CI fails if it is stale.
- The app's TypeScript types are generated from the committed `openapi.json` (`openapi-typescript`), never written by hand. Mobile work needs no Python and no running backend. Regenerating both is part of any API change.
- Audio upload: multipart, one file per recording. Audio download: `GET` with HTTP Range.

### Citations
Every answer and summary claim that cites a source carries `{recording_id, segment_id, start_ms}`. The app opens the recording at that segment and can play the audio from `start_ms`.

### Database rules
- SQLite with foreign keys on; schema changes are numbered SQL migration files applied at startup, never edited after merge.
- Only the backend touches `app.db`.

### Branches and versions
- `main` changes only through PRs merged by the lead. One branch per plan: `plan/<stage>-<topic>`.
- Dependency majors are pinned to the versions in `project_knowledge.md` § Tech stack. A major upgrade is a separate, explicit decision.
