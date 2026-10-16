# Stage 1 design: processing, speech, analysis, chunking

Part of the stage 1 spec (overview: `2026-10-16-stage-1-design.md`). Approved in sections 2–6 of the brainstorming.

## 1. Pipeline
One worker in the server process takes one recording at a time (roadmap lifecycle):

| Step | Status shown | Does |
|---|---|---|
| decode | `transcribing` (decode is quick and shown as part of it) | PyAV decodes the upload to 16 kHz mono float32, writes it to `<data dir>/tmp/<rec_id>/audio.npy`, sets `duration_ms` and `waveform_peaks` (96 peak values 0–1) |
| transcribe | `transcribing` | ASR child process → segments |
| diarize (meetings) | `diarizing` | diarizer child process → speaker turns; each segment gets the speaker with the largest time overlap, or the nearest turn's speaker when none overlaps; speakers labelled A, B… by first appearance |
| analyze | `analyzing` | the Summarizer agent (§4) |
| index | `indexing` | chunk (§5), embed, store |
| done | `ready` | temp folder deleted |

- Claim: recordings carry a `claimed` flag. The worker takes the oldest unclaimed recording in a non-terminal status with `UPDATE recordings SET claimed=1 WHERE id=? AND claimed=0 AND status NOT IN ('ready','failed')` and processes it from its current status; a new upload starts at `uploaded` (decode runs first). `claimed` is cleared when the recording reaches `ready` or `failed`.
- Status moves: the worker sets `transcribing` when decode starts, then each step's status as it starts (table above). Retry maps `failed_step` to a resume status: `decoding` → `uploaded` (decode runs again), every other step → its own status.
- Any step that needs the waveform decodes first if `audio.npy` is missing (e.g. after a restart).
- Each step first deletes its own partial output, so it is idempotent.
- Resume: on server start, every `claimed` flag is cleared first, then recordings in a non-terminal status are re-queued at the step they were in (roadmap). Resuming at diarizing or later re-decodes the audio (the waveform is not stored); stored `waveform_peaks` are kept.
- Retry (`POST …/retry`, only `failed`) sets the status to `failed_step`'s status with `claimed=0`, so the worker resumes there, keeping completed steps' output.
- Zero segments after transcription (silence, accidental tap): no diarization or LLM call; analysis is the fixed result title "Untitled recording", no items, no tags; then `ready`.
- Analysis runs only before `ready`; a `ready` recording is never re-processed, so user edits to title, tags and speaker names are never overwritten.

## 2. Speech execution
Evidence: `yassinebrahem2/live-debate-analysis` runs Whisper and pyannote as separate processes in production and never ran them in one process.
- ASR and diarization each run in a child process started with `subprocess.run([sys.executable, "-m", "app.speech.<step>", <args>])` (not `multiprocessing` spawn, which re-imports the parent's main module on Windows). The child loads `audio.npy` into memory, loads its model, writes a JSON result, and exits; exiting frees all GPU memory, so the 6 GB GPU never holds both models. pyannote receives an in-memory waveform, never an audio path (roadmap).
- The child imports only `app.speech`; it never touches the database or the LLM layer. The parent writes results.
- Non-zero exit (including CUDA out-of-memory) → the step's error code; child stderr goes to the server log only; a configurable step timeout kills a hung child.
- Every child gets the model cache dir (`HF_HOME` and the fastembed cache path); `serve` sets `HF_HUB_OFFLINE=1`, so nothing downloads during the demo and a missing model fails at once.
- ASR (faster-whisper, `asr` role): device and compute type from `config/models.yaml` (`cuda` + `int8_float16`), overridable per machine with `ASR_DEVICE=cpu` in `backend/.env` (`cpu` + `int8`, slower); `language="en"`, `vad_filter=True`, `condition_on_previous_text=False`. Output: segments with start, end, text.
- Diarizer (pyannote `speaker-diarization-community-1`, `diarizer` role, needs `HF_TOKEN`): device from config, overridable with `DIARIZER_DEVICE=cpu`; CPU works, slower.
- Backends: `real` or `fake`, chosen in backend settings. `fake` returns a canned transcript and speakers for any audio; used by tests and CI (no torch) and for instant UI work. `/health` and Settings show "Speech: fake (dev)" when it is active.

## 3. Prompts: shared rules
- Prompt text lives in files in `backend/app/agents/prompts/`, one per agent and mode, loaded at startup.
- Untrusted text is data: transcripts are wrapped in `<transcript>…</transcript>` and Chat tool output in `<sources>…</sources>`; closing delimiters inside the text are escaped first; every prompt says to ignore instructions found inside.
- Speakers appear only as `Speaker A`, `Speaker B`…; prompt rule: always write each speaker as `Speaker X`, never combined.
- Sources appear only as short labels: `[S n]` (processing), `[P n]` / `[R n]` (Chat).
- English only.

## 4. Analysis: the Summarizer agent (role `llm_analysis`)
The Summarizer is an agent built by the agent factory (`create_agent(name="summarizer", response_format=ToolStrategy(...))`), used here and by Chat's multi-recording merge (chat file §2).

Input: the transcript rendered by turn, `Speaker B:` once per turn with `[S n]` before each segment (notes: `[S n]` before each segment, no speaker), plus the 40 most used existing tags.

```python
class Item(BaseModel):
    text: str                                              # may mention "Speaker A"
    sources: list[int] = Field(min_length=1, max_length=3) # S numbers

class ActionItem(Item):
    owner: str | None      # a speaker label ("A") or None
    due: str | None        # as said ("Friday"); never invented

class MeetingAnalysis(BaseModel):
    title: str = Field(max_length=60)                       # no date
    tags: list[str] = Field(min_length=1, max_length=4)
    overview: str                                           # 2–3 sentences, not cited
    decisions: list[Item]
    action_items: list[ActionItem]
    open_questions: list[Item]

class NoteAnalysis(BaseModel):
    title: str = Field(max_length=60)
    tags: list[str] = Field(min_length=1, max_length=4)
    key_points: list[Item] = Field(min_length=1, max_length=8)  # as many as the content supports
    clean_text: str        # tidy prose of what was said; fillers and false starts removed; nothing added; not cited
```
`ToolStrategy` re-asks the model after a validation error (`handle_errors` defaults to `True`, verified in langchain 1.4.6).

Prompt core (meeting): summarize only what was said; every decision, action item and open question cites 1–3 `[S n]`; a decision was agreed by the group, an action item has a doer, an open question was raised and not settled; never guess owners or dates. Note: as many key points as the content supports (at most 8), each cited; the clean note keeps the speaker's meaning and adds nothing.

After the call (server):
- S numbers → segment ids; an unknown S number is removed and logged; an item left without a valid source is removed and logged.
- `owner` checked against the recording's speakers → `speaker_id`, or null if unknown.
- `Speaker X` → speaker token (data-API file §3).
- Tags normalised (lowercase, trimmed, spaces → hyphens, ≤ 24 chars, ≤ 4); a new tag equal to an existing one after normalisation or after removing a trailing "s" reuses it.
- Stored in `recordings.analysis` and `title`.

Failover walk (no fallback middleware for this role; each model's Summarizer is built with `ModelCallLimitMiddleware(run_limit=2, exit_behavior="end")`, so validation re-asks are bounded and a missing structured response moves on to the next model): the workflow picks the first model in `llm_analysis` and plans from its `max_request_tokens` (input estimate chars/4 + output and reasoning allowance):
- fits → one call;
- too large → map-reduce: split on segment boundaries; one map call per section → `SectionNotes` (meeting: decisions, action items, open questions; note: key points and that section's part of the clean note) with global S numbers; one reduce call → title, tags, overview and merged items (meeting) or title, tags, key points (note) from the section notes only; a note's clean text is the sections' parts joined in order by code.
- Each model gets at most 2 model calls per request (validation re-asks included); then the next model in the list, re-planning from its `max_request_tokens`. All exhausted → `failed` with `analysis_failed`.

## 5. Chunking and indexing
- Chunks pack consecutive segments up to ≈ 200 tokens (chars/4), never splitting a segment (ASR segments are well under the embedder's 512-token input).
- Meetings: a chunk also ends at a speaker change once it holds ≥ 80 tokens.
- Overlap: a chunk's last segment is repeated as the next chunk's first.
- Embedded text: `Speaker B: …` lines (labels, not names) for meetings; plain text for notes; no title. A rename never needs re-indexing.
- Embedder: fastembed `BAAI/bge-small-en-v1.5` (`embedder` role) through one wrapper: passages embedded as is; queries get BGE's query instruction ("Represent this sentence for searching relevant passages: ") added by the wrapper, because fastembed 0.9's `query_embed` does not add it (verified).
- Parameters (chunk size, boundary minimum, overlap) are backend settings.

## 6. Processing failures
- Each step catches its errors, logs them, and sets `failed` with `failed_step` and a code: `audio_unreadable`, `transcription_failed`, `diarization_failed`, `analysis_failed`, `indexing_failed`. The worker then takes the next recording; one failure never stops the queue.
- Diarization failure fails the meeting (no silent fallback to one speaker).
- Upload limits: max size in settings (default 200 MB) → `payload_too_large`; unsupported type → `unsupported_media_type`. A failed upload leaves no row and no partial file.
- Delete vs worker: queued, ready and failed recordings delete at once; the recording the worker has claimed returns `409 recording_busy`. Delete is `DELETE … WHERE id=? AND claimed=0`; SQLite serialises the claim and the delete, so they cannot interleave.
- Every LLM request has a timeout per model from `models.yaml`; a timeout counts as that model failing.
