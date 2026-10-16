# Stage 1 design: data model and API

Part of the stage 1 spec (overview: `2026-10-16-stage-1-design.md`). Follows the roadmap contracts (IDs, times, error shape, migrations, openapi.json). Field names are snake_case; times are milliseconds; wall-clock times are UTC ISO 8601.

## 1. Data model (SQLite, foreign keys on, `ON DELETE CASCADE` from recordings and chats)

**recordings**
| Column | Type | Notes |
|---|---|---|
| id | text PK | `rec_…` |
| kind | text | `meeting` \| `note` |
| client_upload_id | text unique | from the app; makes upload idempotent |
| status | text | `uploaded`, `transcribing`, `diarizing`, `analyzing`, `indexing`, `ready`, `failed` |
| claimed | int | 1 while the worker processes it (processing file §1) |
| failed_step | text null | the step that failed (`decoding`, `transcribing`, `diarizing`, `analyzing`, `indexing`) |
| error_code / error_message | text null | set when `failed` |
| title | text null | null until analysed; editable when `ready` |
| created_at | text | UTC ISO 8601 |
| duration_ms | int null | set by decode |
| audio_ext | text | original upload extension (`m4a`) |
| waveform_peaks | text null | JSON list of 96 floats 0–1, set by decode |
| analysis | text null | JSON of the stored analysis (§2), speaker tokens inside text |

**speakers** (meetings): id `spk_…`, recording_id, label (`A`, `B`… by first appearance), name (null until renamed).

**segments**: id `seg_…`, recording_id, idx (order), start_ms, end_ms, speaker_id (null for notes), text. One ASR segment each (roadmap).

**chunks**: id `chk_…`, recording_id, first_segment_id, last_segment_id, start_ms, end_ms, text, embedding (BLOB, 384 float32).

**tags**: id `tag_…`, name (unique, normalised). **recording_tags**: recording_id, tag_id (PK both).

**chats**: id `cht_…`, created_at. **messages**: id `msg_…`, chat_id, role (`user` \| `assistant`), text, citations (JSON, assistant only: list of `{n, recording_id, segment_id, start_ms, recording_title}` and the marker positions), reply_type (assistant), scope and tag_ids (user messages), created_at. Assistant messages never store source labels.

Not stored: chat run state (in memory, keyed by the user message id); decoded audio (temp `.npy` per recording, deleted after processing and on delete).

Delete of a recording removes its rows (cascade), chunks with their embeddings, audio file and temp folder in one operation (roadmap), under the claim rule in the processing file §6.

## 2. Stored and API analysis shape
Separate from the LLM output schemas (processing file §4), whose Field constraints apply only to model output; the fixed result for an empty recording (no tags, no items) is a valid stored value.
```python
class Citation(BaseModel):          # roadmap Citations contract
    recording_id: str
    segment_id: str
    start_ms: int

class AnalysisItem(BaseModel):
    text: str                       # rendered with current speaker names in the API
    citations: list[Citation]

class AnalysisActionItem(AnalysisItem):
    owner_speaker_id: str | None
    due: str | None

class MeetingSummary(BaseModel):
    overview: str
    decisions: list[AnalysisItem]
    action_items: list[AnalysisActionItem]
    open_questions: list[AnalysisItem]

class NoteContent(BaseModel):
    key_points: list[AnalysisItem]
    clean_text: str
```
`recordings.analysis` holds `MeetingSummary` (meetings) or `NoteContent` (notes); `GET /recordings/{id}` returns it as `summary` or `note`. S numbers never leave the backend.

## 3. Speaker tokens
Stored analysis text never contains names. On write, `Speaker X` (regex `\bSpeaker ([A-Z])\b` with optional `'s`, only labels that exist in the recording, case-sensitive) becomes `{{spk_…}}`. One server-side renderer turns tokens into the current name (or "Speaker A") for the API, for Chat tool output and for the merge call, so no client or model ever sees a raw token. The API returns rendered text.

## 4. REST API (`/api/v1`)
| Method and path | Purpose | Notes |
|---|---|---|
| `GET /health` | identity and readiness | `{app_name, version, speech_backend: "real"\|"fake", roles: {llm, llm_analysis, embedder, asr, diarizer: "ready"\|"<reason>"}}`; presence checks only, no model loading |
| `POST /recordings` | upload | multipart: `kind`, `client_upload_id`, `file`. 201 new; 200 with the existing recording for a known `client_upload_id`. Row created only after the whole file is saved |
| `GET /recordings` | library | query: `kind`, `q` (title, tags, transcript text), `tag_id` (repeatable); newest first |
| `GET /recordings/{id}` | detail | recording + rendered analysis + tags + speakers + segments |
| `PATCH /recordings/{id}` | edit | `{title?, tags?: [name]}`; only when `ready` (else 409 `not_ready`); tags normalised and reused |
| `PATCH /recordings/{id}/speakers/{speaker_id}` | rename | `{name}` (empty string clears); only when `ready` |
| `DELETE /recordings/{id}` | delete | 409 `recording_busy` if the worker is processing it |
| `POST /recordings/{id}/retry` | retry | only when `failed` (else 409 `not_failed`); resumes at `failed_step` |
| `GET /recordings/{id}/audio` | audio | original file, HTTP Range |
| `GET /tags` | vocabulary | `[{id, name, count}]` for chips and search suggestions |
| `POST /chats` | new chat | `{id}` |
| `GET /chats/{chat_id}` | messages | for display after reopening |
| `POST /chats/{chat_id}/messages` | ask | `{text, scope: "notes"\|"meetings"\|"both", tag_ids}` → 202 `{run_id}` (= the user message id) |
| `GET /chats/{chat_id}/runs/{run_id}` | poll | `{status: "running"\|"done"\|"failed", steps: [str], message?, error?}`; 404 `not_found` if the run is gone |
| `POST /chats/{chat_id}/runs/{run_id}/retry` | retry | re-runs the stored question under the same run id; allowed when the run failed or no longer exists (server restart); 409 `not_failed` while it is running or done |

## 5. Errors
Shape (roadmap): `{"error": {"code": "<snake_case>", "message": "<human text>"}}`. FastAPI's `RequestValidationError` (422) and `HTTPException` are mapped to this shape by exception handlers.

Closed list of codes (a backend enum exported in `openapi.json`): `validation_error`, `not_found`, `payload_too_large`, `unsupported_media_type`, `recording_busy`, `not_failed`, `not_ready`, `audio_unreadable`, `transcription_failed`, `diarization_failed`, `analysis_failed`, `indexing_failed`, `ai_unavailable`, `timed_out`, `not_implemented` (501, routes the foundation stubs until a feature plan fills them), `internal_error`.

Messages never contain keys, URLs with credentials, data-dir paths or stack traces; details go to the server log.
