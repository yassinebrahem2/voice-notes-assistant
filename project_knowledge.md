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
- [USER] Audio is kept until the user deletes the recording.

### Models
- [AGREED] One model configuration file, following the design (not the code) of `multimodal-rag-agent`'s registry: providers (`base_url`, `key_env`), models (`type`, `provider`, `wire_model_id`), keys only in environment variables, a small loader.
- [USER] The app name lives in its own single config value.

### Mobile
- [USER] React Native. Android only (APK).

### Deployment
- [USER] The phone reaches the laptop through a tunnel. The server URL is configurable in the app.

### Prompting [BRIEF]
- Structured output for summaries.
- Guardrails: answers rely only on retrieved transcript content; the model does not invent what was not said.

### Process
- [USER] Team of 4. Lead: GitHub `yassinebrahem2`. Coding agents: Codex, Claude Code, Antigravity.
- [USER] Work follows `new-project-playbook.md`. Repo setup, roadmap and infrastructure are done on 2026-10-16; the following days are for building.
- [USER] `main` is the integration branch, with `plan/*` branches per the playbook.
- [BRIEF] The coding assistant asks before choosing the stack for any open item.

## 3. Open
- **Data location** (Claude recommends: everything on the laptop, phone keeps only its settings; awaiting the user's yes).
- **Registry amendment** (Claude recommends a role-based file covering local speech models too; awaiting the user's yes).
- **Stack** (proposal awaiting the user's yes): backend, vector store, embedder, ASR and diarizer models, LLM provider, agent framework, mobile UI kit, APK build path.
- **Tunnel and security**: which tunnel; whether a bearer token is needed.
- **Spikes not yet run**: sqlite-vec loading on the laptop's Python; a tool-call round trip with the chosen free provider and framework; pyannote loading with `HF_TOKEN`.
- **Agent design**: which agents exist and how they hand off. Decided in the stage 1 spec.
- **Failure behaviour**. Decided in the stage 1 spec.
- **Chunking strategy**. A config choice; a comparison is not in scope for 2026-10-20. [BRIEF]
- **Privacy and consent**. Decided in the stage 1 spec. Free LLM tiers may use inputs for training.

## 4. Ideas
- Live transcript while recording (user: "we'll see if we can reach it later").

## 5. Changed
- Upload audio and transcribe on the server (brief) → transcription and diarization on the phone (2026-10-16, user) → recording on the phone, transcription and diarization on the laptop (2026-10-16, user: on-device models need a native build).
- iPhone first via Expo Go, Android later (2026-10-16, user) → Android only (2026-10-16, user).
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
