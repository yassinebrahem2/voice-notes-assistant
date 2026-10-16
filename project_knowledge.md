# Project Knowledge File: Voxa (working name)

Current state of the project, rewritten 2026-10-16. Sections: brief, decided, open, ideas, changed, files.
Sources: [BRIEF] the brief (`project_context.md`). [USER] stated by the user. [AGREED] proposed by Claude and explicitly accepted by the user.
Anything not listed here is unknown.

## 1. Brief [BRIEF]
- Title: Meeting & Voice Notes Assistant. Working name Voxa (placeholder, can be changed).
- Goal: a mobile app that records audio from meetings, conversations, or a single person talking and brainstorming. Recordings are transcribed and saved. The user can tag them, ask questions about them in natural language, and get summaries of meetings and conversations.
- Problem: spoken information (decisions, ideas, action items) gets lost because recordings are rarely re-listened to and transcripts are unorganized. The app makes that audio searchable and queryable.
- Deadline: Tuesday 2026-10-20, a demo to the professor. [USER]
- Done for now: a working end-to-end system on a real phone. It does not need to be perfect. More to discuss. [USER]

## 2. Decided

### Product and users
- [USER] Single user, no accounts.
- [USER] Recordings are in English.
- [USER] Live recording is in scope.
- [USER] The app name is not settled and must be configurable from one place.
- [BRIEF] Capabilities: audio capture (meetings, conversations, solo brainstorming); transcription; tagging (topic, project, meeting type); question answering grounded in stored transcripts, ideally citing recording and moment; summaries on request, structured as decisions / action items / open questions.

### Architecture
- [USER] Multi-agent and RAG are requirements.
- [USER] Transcription and diarization run on the phone. Diarization output gives the timestamps.
- [USER] Model-related work (LLMs, agents) runs on the server. Whether embedders also run on the phone is still being considered.
- [USER] No automation platform. Everything is code.
- [BRIEF] Transcription, tagging and retrieval are deterministic workflows, not agents. Only the reasoning parts are agents.
- [BRIEF] RAG: transcripts are chunked, embedded and stored in a vector store; questions retrieve relevant chunks first.

### Data
- [USER] Data is saved locally.
- [USER] Audio is stored temporarily, until it is transcribed.

### Models
- [USER] Model configuration reuses the model registry from `multimodal-rag-agent`, so models are configurable from one file.
- [USER] Free options only. Models are always hosted, never self-hosted.

### Mobile
- [USER] iPhone first, via Expo Go. Android later, as an APK.

### Prompting [BRIEF]
- Structured output for summaries.
- Guardrails: answers rely only on retrieved transcript content; the model does not invent what was not said.

### Process
- [USER] Team of 4. Lead: GitHub `yassinebrahem2`. Coding agents: Codex, Claude Code, Antigravity.
- [USER] Work follows `new-project-playbook.md`. Repo setup, roadmap and infrastructure are done on 2026-10-16; the following days are for building.
- [BRIEF] The coding assistant asks before choosing the stack for any open item.

## 3. Open
- Expo Go vs. on-device transcription and diarization. Expo Go cannot load custom native modules such as whisper.rn; on-device models need a development build. Blocks the mobile stack and install path.
- The user's existing live transcription and diarization project: language, framework, platform it was tested on, and whether it can be shared in GitHub. Blocks the mobile stack.
- What "data saved locally" covers: on the phone only, with a stateless server, or with the vector index on the server. Blocks the backend's responsibilities.
- "Never locally hosted" vs. "embedders locally too": does it mean no self-run model servers, with on-device models as a separate category? Blocks the embedder choice.
- Server location for the demo: cloud or laptop (the user said both). Blocks deployment work.
- Registry reuse: port the code from `multimodal-rag-agent`, or reuse its shape in a slimmer form. "One file" vs. that project's two files (`models.yaml`, `providers.yaml`).
- User workflow: what the user can do, end to end. To be discussed before any UI talk.
- MVP scope for 2026-10-20.
- Agent design: which agents exist and how they hand off (the brief's Summarization + Orchestrator is a starting point, not settled).
- Failure behaviour (to be discussed).
- Chunking strategy, and whether a comparison is in scope. [BRIEF]
- Privacy and consent handling. [BRIEF]
- Tags: automatic, manual, or both (the brief says both).
- Git branches: `main` plus `plan/*` per the playbook, vs. the session's assigned branch.

## 4. Ideas
- (none yet)

## 5. Changed
- Upload audio and transcribe on the server (brief, flow steps 1–2) → transcription and diarization on the phone (2026-10-16, user).
- Timestamps and speaker labels "desirable, not decided" (brief) → diarization is in and provides timestamps (2026-10-16, user).
- Live vs. record-then-upload open (brief) → live recording in scope (2026-10-16, user).
- Automation platform vs. custom backend open (brief) → all code, no automation platform (2026-10-16, user).
- Local vs. hosted models open (brief) → hosted, free options for server-side models (2026-10-16, user).

## 6. Files
- `project_knowledge.md`: this file.
- `project_context.md`: the original idea file, kept unchanged as the source of [BRIEF].
- `new-project-playbook.md`: how the work is run.
