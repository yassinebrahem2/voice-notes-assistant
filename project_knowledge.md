# Project Knowledge File: Voxa (working name)

Current state of the project, rewritten 2026-10-16. Sections: brief, decided, open, ideas, changed, files.
Sources: [BRIEF] the brief (`project_context.md`). [USER] stated by the user. [AGREED] proposed by Claude and explicitly accepted by the user.
Anything not listed here is unknown.

## 1. Brief [BRIEF]
- Title: Meeting & Voice Notes Assistant. Working name Voxa (placeholder, can be changed).
- Goal: a mobile app that records audio from meetings, conversations, or a single person talking and brainstorming. Recordings are transcribed and saved. The user can tag them, ask questions about them in natural language, and get summaries of meetings and conversations.
- Problem: spoken information (decisions, ideas, action items) gets lost because recordings are rarely re-listened to and transcripts are unorganized. The app makes that audio searchable and queryable.
- Deadline: Tuesday 2026-10-20. [USER]

## 2. Decided

### Product and capabilities [BRIEF]
- Audio capture: records meetings, conversations, or solo voice brainstorming.
- Transcription: converts audio to text and saves it.
- Tagging: transcripts are organized by tags (topic, project, meeting type).
- Question answering: the user asks questions (e.g. "what did we decide about the budget?") and the answer is grounded in the stored transcripts, ideally citing which recording and moment it came from.
- Summarization: summaries of a meeting or conversation on request. A useful structure is decisions / action items / open questions.

### Architecture [BRIEF]
- Multi-agent system for the reasoning steps, combined with workflows for the fixed pipeline steps.
- RAG: transcripts form a growing knowledge base that is chunked, embedded, and stored in a vector store; questions retrieve relevant chunks first.
- Transcription, tagging, and retrieval are deterministic workflows, not agents. Only the reasoning parts are agents.

| Component | Type | Responsibility |
|---|---|---|
| Transcription | Workflow | Audio to timestamped text |
| Tagging | Workflow | Assigns topic/project/meeting-type tags to transcripts or segments |
| Retrieval | Workflow | Searches stored transcripts (chunk, embed, vector search) and returns relevant chunks |
| Summarization | Agent | Produces structured summaries |
| Orchestrator | Agent | Routes a request (question vs. summary), calls the workflows as tools, formats the cited answer |

### Flow [BRIEF]
1. User records audio in the mobile app and uploads it.
2. Transcription workflow produces the transcript.
3. Tagging workflow labels it; transcript is chunked, embedded, and stored.
4. Later the user asks a question or requests a summary.
5. Orchestrator agent decides what to do and calls the retrieval workflow and/or the summarization agent.
6. Answer is returned with source references (recording, timestamp).

### Prompting [BRIEF]
- Structured output for summaries.
- Guardrails so the model does not invent things that were not said; answers rely only on retrieved transcript content.

### Process
- [BRIEF] The coding assistant does not assume decisions beyond what is written; it asks before choosing the stack for any open-decision item.
- [USER] Work follows `new-project-playbook.md`.

## 3. Open
- Tech stack: mobile app, backend, vector store, embedding model, transcription model. [BRIEF]
- Where the pipeline runs: automation platform vs. custom backend. [BRIEF]
- Speaker diarization (who said what). [BRIEF]
- Timestamps and speaker labels: "desirable, not decided". [BRIEF] (Citing "which moment" depends on timestamps; see gap analysis.)
- Local vs. hosted models. [BRIEF]
- Live/continuous recording vs. record-then-upload. [BRIEF]
- Privacy and consent handling for recorded conversations. [BRIEF]
- Chunking strategy: the brief says fixed-size windows vs. segments by speaker turn or topic are "worth comparing". Whether a comparison is in scope, and how it is measured, is open. [BRIEF]
- Everything raised in the Phase 1 gap analysis (deliverable on Tuesday, team, users, scope, languages, tag model, deployment).

## 4. Ideas
- (none yet)

## 5. Changed
- (none yet)

## 6. Files
- `project_knowledge.md`: this file.
- `project_context.md`: the original idea file, kept unchanged as the source of [BRIEF].
- `new-project-playbook.md`: how the work is run.
