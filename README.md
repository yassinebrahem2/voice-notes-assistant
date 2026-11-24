# Meeting & Voice Notes Assistant

A mobile app that records meetings, conversations and solo voice notes, transcribes them on a laptop server, and lets you search, summarise and ask questions about them in natural language, with answers that cite the exact moment they came from.

The app's name and version are defined only in [`config/app.json`](config/app.json).

## What it does

- **Meetings**: record several speakers; the transcript is split into speaker turns (diarization), speakers can be renamed everywhere, and each meeting gets an auto-title, tags and a structured summary (decisions / action items / open questions) whose items cite transcript lines.
- **Notes**: one-tap voice notes turned into a clean note with key points, the raw transcript one tap away.
- **Chat**: ask questions across notes, meetings or both (optionally filtered by tag). Answers are grounded in your recordings and cite sources; tapping a citation opens the transcript line and plays the audio from that moment. When nothing matches, it says so.
- **Everywhere**: library with search and tag filter, playback, delete, dark mode, server URL in Settings.

## Architecture

```
Android phone (Expo app)  ──HTTPS over Tailscale (private tailnet)──▶  Laptop: FastAPI backend
                                                                        ├─ SQLite + sqlite-vec (records + vectors)
                                                                        ├─ audio files (per-user data dir)
                                                                        ├─ worker: ASR → diarization → analysis → indexing
                                                                        └─ Chat: LangGraph multi-agent system (hosted LLMs)
```

- **Speech**: faster-whisper for transcription, pyannote for meeting diarization, each in its own child process (one model on the GPU at a time).
- **Analysis and Chat**: hosted free-tier LLMs (Groq, with Gemini as failover). An orchestrator agent searches transcripts, looks up recordings and calls a summarizer agent; a deterministic check validates every citation.
- **RAG**: transcripts are chunked (~200 tokens, preferring speaker changes), embedded locally with `BAAI/bge-small-en-v1.5` (fastembed) and searched exactly with sqlite-vec.
- **n8n mode** (optional, `AI_BACKEND=n8n`): analysis, embedding and the Chat agent run as n8n workflows with Gemini; the app is unchanged.
- **Models** are chosen by role (`llm`, `llm_analysis`, `embedder`, `asr`, `diarizer`) in [`config/models.yaml`](config/models.yaml); secrets live only in `backend/.env`.

Processing lifecycle of a recording: `uploaded → transcribing → diarizing (meetings) → analyzing → indexing → ready`, or `failed` with a one-tap retry that resumes from the failed step.

## Repository layout

```
backend/   Python 3.12 service: FastAPI API, worker, speech, RAG, agents (uv)
mobile/    Expo SDK 58 app (expo-router, TanStack Query, React Native Paper)
config/    app.json (name, branding), models.yaml (models by role)
n8n/       Docker Compose, import script and workflows for n8n mode
docs/      roadmap, setup guide, specs and implementation plans
scripts/   project board helper
```

Runtime data (database, audio, model caches) lives outside the repository, in the per-user app-data directory.

## Quick start

Full instructions, including Tailscale HTTPS, the Hugging Face token, model downloads and n8n mode, are in [`docs/setup.md`](docs/setup.md).

Backend (from `backend/`):

```bash
uv sync --locked
cp .env.example .env   # then add GROQ_API_KEY and/or GEMINI_API_KEY
uv run python -m app.cli serve
```

Set `SPEECH_BACKEND=fake` in `.env` to develop without torch or speech models. On the laptop with a GPU, install real speech and download the models once:

```bash
uv sync --extra speech
uv run --extra speech python -m app.cli setup
uv run --extra speech python -m app.cli serve
```

Mobile (from `mobile/`):

```bash
npm ci
npx expo start
```

Open it in Expo Go on Android, then enter the backend's Tailscale HTTPS URL under Settings → Server.

## Development

| | Backend (`backend/`) | Mobile (`mobile/`) |
|---|---|---|
| Tests | `uv run pytest` | `npx jest --ci` |
| Lint | `uv run ruff check .` | `npx eslint .` |
| Format | `uv run ruff format --check .` | `npx prettier --check .` |
| Types | `uv run pyright` | `npx tsc --noEmit` |
| API | `uv run python -m app.cli export-openapi` | `npm run gen:api` |

The backend's Pydantic models are the API's source of truth: `backend/openapi.json` is committed and the app's TypeScript types are generated from it. Other CLI commands: `seed-demo`, `smoke-llm`, `calibrate-retrieval` (see the setup guide).

## Contributing

Work is organised as specs → plans → task issues on the [project board](https://github.com/users/yassinebrahem2/projects/6). Every contributor and coding agent follows [`AGENTS.md`](AGENTS.md); shared contracts are in [`docs/roadmap.md`](docs/roadmap.md), project decisions in [`project_knowledge.md`](project_knowledge.md).

Use demo recordings only: free LLM tiers may use inputs for training.
