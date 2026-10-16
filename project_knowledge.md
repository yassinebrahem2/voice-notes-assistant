# Project Knowledge File: Voxa (working name)

Current state of the project, rewritten 2026-10-16. Sections: brief, decided, open, ideas, changed, files.
Sources: [BRIEF] the brief (`project_context.md`). [USER] stated by the user. [AGREED] proposed by Claude and explicitly accepted by the user.
Anything not listed here is unknown.

## 1. Brief [BRIEF]
- Title: Meeting & Voice Notes Assistant. Working name Voxa (placeholder, can be changed).
- Goal: a mobile app that records audio from meetings, conversations, or a single person talking and brainstorming. Recordings are transcribed and saved. The user can tag them, ask questions about them in natural language, and get summaries of meetings and conversations.
- Problem: spoken information (decisions, ideas, action items) gets lost because recordings are rarely re-listened to and transcripts are unorganized. The app makes that audio searchable and queryable.
- Deadline: Tuesday 2026-10-20, a demo to the professor. [USER]
- Done for now: a working end-to-end system on a real phone. It does not need to be perfect, but it must look polished and high quality, UX-wise and feature-wise. [USER]

## 2. Decided

### Product and users
- [USER] Single user, no accounts.
- [USER] Recordings are in English.
- [USER] The app name is not settled and must be configurable from one place.
- [USER] Three sections:
  - **Meetings**: several people talk; diarization is crucial.
  - **Notes**: voice note-taking; a different thing from meetings.
  - **Chat**: a chatbot that can be set to answer about notes, about meetings, or both.
- [USER] Base user flow (the simplest version, to be detailed): record → transcript with speaker labels → saved, auto-tags suggested and editable → library by date and tag → open one for transcript and summary → ask questions with answers citing recording and timestamp, or "not in your recordings".
- [BRIEF] Capabilities: audio capture; transcription; tagging (topic, project, meeting type); question answering grounded in stored transcripts, citing recording and moment; summaries structured as decisions / action items / open questions.

### Architecture
- [USER] Multi-agent and RAG are requirements.
- [USER] The phone app records; transcription and diarization run on a laptop that acts as the server. Diarization output gives the timestamps.
- [USER] LLMs are always hosted (free options), never self-hosted. Embedders may run on the laptop or be hosted (undecided).
- [USER] No automation platform. Everything is code.
- [USER] The transcription and diarization approach comes from `yassinebrahem2/live-debate-analysis` (Python; faster-whisper `large-v3` fp16 + pyannote `speaker-diarization-community-1`; batch over files, tested on a Windows laptop with a 6 GB RTX 4050).
- [BRIEF] Transcription, tagging and retrieval are deterministic workflows, not agents. Only the reasoning parts are agents.
- [BRIEF] RAG: transcripts are chunked, embedded and stored in a vector store; questions retrieve relevant chunks first.

### Data
- [USER] Audio is stored temporarily, until it is transcribed.

### Models
- [USER] Model configuration follows the model registry design of `multimodal-rag-agent`, configurable from one file.
- [USER] Accepted: reuse that registry's design, not its code: one `models.yaml` with providers (`base_url`, `key_env`) and models (`type`, `provider`, `wire_model_id`), keys only in environment variables, a small loader. (Accepted for the hosted-only version; the amendment for local speech/embedder entries is under Open.)
- [USER] The app name lives in its own single config value.

### Mobile
- [USER] React Native (the easiest stack). iPhone via Expo Go first; Android APK later.

### Prompting [BRIEF]
- Structured output for summaries.
- Guardrails: answers rely only on retrieved transcript content; the model does not invent what was not said.

### Process
- [USER] Team of 4. Lead: GitHub `yassinebrahem2`. Coding agents: Codex, Claude Code, Antigravity.
- [USER] Work follows `new-project-playbook.md`. Repo setup, roadmap and infrastructure are done on 2026-10-16; the following days are for building.
- [USER] `main` is the integration branch, with `plan/*` branches per the playbook.
- [BRIEF] The coding assistant asks before choosing the stack for any open item.

## 3. Open
- **Live transcription.** The debate pipeline is batch over whole files; pyannote community-1 relabels speakers on every chunk; expo-audio records to a file and has no chunk stream. Options: record live and process on stop (tested pipeline), or a live transcript as a stretch (dev build with a streaming library, needs a Mac; or chunked uploads that lose words at the seams). Blocks the recording flow.
- **Data location.** Best reading: everything on the laptop (SQLite plus a vector store), phone as a thin client. Not yet confirmed.
- **Keeping audio.** Deleting audio after transcription means citations cannot play the moment back. Keep it until the user deletes it?
- **Registry amendment.** The one file must also cover local speech models (ASR, diarizer) and possibly a local embedder, not only hosted LLMs.
- **GPU limits on the laptop.** 6 GB card: one GPU model at a time, so processing jobs run one at a time; Whisper and pyannote in separate steps; a laptop embedder runs on CPU or is hosted.
- **Teammates' machines.** OS and GPU of each teammate; a CPU dev profile (small model, sherpa-onnx CPU diarization) may be needed. Each developer needs `HF_TOKEN` and must accept the pyannote model's terms.
- **Demo network.** Campus Wi-Fi often isolates clients; phone hotspot or a tunnel (e.g. Tailscale); server URL as an app setting.
- **Expo Go SDK version.** The App Store Expo Go supports one SDK version; check before pinning.
- **Feature detail per section** (Meetings, Notes, Chat, global), must-have vs. stretch.
- **Agent design**: which agents exist and how they hand off. Decided in the stage 1 spec.
- Failure behaviour (to be discussed).
- Chunking strategy, and whether a comparison is in scope. [BRIEF]
- Privacy and consent handling. [BRIEF]
- Tags: automatic, manual, or both (the brief says both).

## 4. Ideas
- (none yet)

## 5. Changed
- Upload audio and transcribe on the server (brief) → transcription and diarization on the phone (2026-10-16, user) → recording on the phone, transcription and diarization on a laptop server (2026-10-16, user: on-device models need a development build, which Expo Go cannot run).
- Server deployed in the cloud (2026-10-16, user) → laptop as the server (2026-10-16, user).
- Expo Go on iPhone with on-device models → React Native via Expo Go with processing on the laptop (2026-10-16, user).
- "Never locally hosted" for all models → LLMs never self-hosted; embedders may be local (2026-10-16, user clarification).
- "Data saved locally" (meaning unclear) → see Open: data location.
- Timestamps and speaker labels "desirable, not decided" (brief) → diarization is in and provides timestamps (2026-10-16, user).
- Automation platform vs. custom backend open (brief) → all code (2026-10-16, user).

## 6. Files
- `project_knowledge.md`: this file.
- `project_context.md`: the original idea file, kept unchanged as the source of [BRIEF].
- `new-project-playbook.md`: how the work is run.
