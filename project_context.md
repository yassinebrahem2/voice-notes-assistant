# Project Context: Meeting & Voice Notes Assistant

(Working name: Voxa. Placeholder, can be changed.)

## What it is
A mobile app that records audio from meetings, conversations, or a single person talking and brainstorming. Recordings are transcribed and saved. The user can tag them, ask questions about them in natural language, and get summaries of meetings and conversations.

## Problem
Spoken information (decisions, ideas, action items) gets lost because recordings are rarely re-listened to and transcripts are unorganized. The app makes that audio searchable and queryable.

## Core capabilities
1. Audio capture: records meetings, conversations, or solo voice brainstorming.
2. Transcription: converts audio to text and saves it (timestamps and speaker labels are desirable, not decided).
3. Tagging: transcripts are organized by tags (topic, project, meeting type).
4. Question answering: the user asks questions (e.g. "what did we decide about the budget?") and the answer is grounded in the stored transcripts, ideally citing which recording and moment it came from.
5. Summarization: summaries of a meeting or conversation on request. A useful structure is decisions / action items / open questions.

## Design direction
- Multi-agent system for the reasoning steps, combined with workflows for the fixed pipeline steps.
- Retrieval-Augmented Generation (RAG): transcripts form a growing knowledge base that is chunked, embedded, and stored in a vector store; questions retrieve relevant chunks first.
- Chunking worth comparing: fixed-size windows vs. segments by speaker turn or topic.

### Components
Transcription, tagging, and retrieval are deterministic workflows (fixed pipeline steps), NOT agents. Only the reasoning parts are agents.

| Component | Type | Responsibility |
|---|---|---|
| Transcription | Workflow | Audio to timestamped text |
| Tagging | Workflow | Assigns topic/project/meeting-type tags to transcripts or segments |
| Retrieval | Workflow | Searches stored transcripts (chunk, embed, vector search) and returns relevant chunks |
| Summarization | Agent | Produces structured summaries |
| Orchestrator | Agent | Routes a request (question vs. summary), calls the workflows as tools, formats the cited answer |

### Flow
1. User records audio in the mobile app and uploads it.
2. Transcription workflow produces the transcript.
3. Tagging workflow labels it; transcript is chunked, embedded, and stored.
4. Later the user asks a question or requests a summary.
5. Orchestrator agent decides what to do and calls the retrieval workflow and/or the summarization agent.
6. Answer is returned with source references (recording, timestamp).

## Prompting notes
- Use structured output for summaries.
- Add guardrails so the model does not invent things that were not said; answers should rely only on retrieved transcript content.

## Open decisions (not yet settled)
- Tech stack for the mobile app, backend, vector store, embedding model, and transcription model.
- Where the pipeline runs (automation platform vs. custom backend).
- Whether to include speaker diarization (who said what).
- Local vs. hosted models.
- Live/continuous recording vs. record-then-upload.
- Privacy and consent handling for recorded conversations.

## Instructions for the coding assistant
Do not assume decisions beyond what is written above. Ask before choosing the stack for any item listed under open decisions.
