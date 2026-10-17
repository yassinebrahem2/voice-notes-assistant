# Stage 1 Processing Implementation Plan

> **For agentic workers:** implement this plan task by task as described in `docs/implementing-plan-tasks.md` (fresh implementer, fresh reviewer, fix loop per task); follow `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** draft. Gets its branch `plan/stage-1-processing` and plan issue after the foundation (#1) merges.

**Goal:** Recordings go from upload to `ready`: upload and audio serving, the processing worker (claim, resume, retry, delete), speech in child processes, storing the analysis, chunking and indexing, and every recordings and tags route.

**Architecture:** Routes call small functions in `app/recordings/` (read and edit) and `app/audio/` (storage, decode, Range). One worker thread claims one recording at a time and runs the step pipeline in `app/processing/`; the real ASR and diarizer run as child processes. Analysis comes from `container.analyzer` (fake until the agents plan binds the Summarizer); this plan stores its output.

**Tech Stack:** FastAPI, SQLite + sqlite-vec, PyAV, fastembed 0.9, faster-whisper 1.2.1, pyannote.audio 4.0.7, torch 2.10.0 (cu128 index on Windows/Linux), pytest.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-processing.md` (pipeline, speech, analysis storage, chunking, failures), `…-design-data-api.md` (schema, routes, errors), `…-design-platform.md` §1–§2 (config, installs).

**Stage overview:** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. **Builds on:** the foundation code on `main` (`Container`, `create_app`, `ApiError`/`ErrorCode`, API models, `app.domain.speakers`, `app.domain.tags`, protocols and fakes, `tests/conftest.py` fixtures `container` and `client`) and the shared helpers from foundation Task 8: `connect(check_same_thread=…)`, `get_db`, `tests.seed` (`seed_recording`, `seed_chunk`), `app.rag.vectors.pack_embedding`, `app.domain.analysis_render.render_analysis`.

## Global Constraints (this plan)
- Everything in the overview's Global constraints.
- Only the backend touches `app.db`. Every thread uses its own connection from `app.db.connection.connect`.
- Audio lives at `<data_dir>/audio/<rec_id>.<ext>`; decoded audio at `<data_dir>/tmp/<rec_id>/audio.npy`, deleted when processing ends and on delete.
- The API returns rendered text (current speaker names); stored analysis text keeps `{{spk_…}}` tokens.
- Embeddings are stored with `pack_embedding` (foundation Task 8: little-endian float32, the format sqlite-vec's `vec_distance_cosine` reads); the agents plan's retrieval reads the same format.
- No migration after `001`.
- The worker never holds the database write lock while it works. A step does its slow work first (decode, the ASR or diarizer child process, the analyze call, `embed_passages`) with no transaction open; then, in ONE short `with conn:` transaction, it deletes its old output, inserts the new output and updates the status. Never hold a transaction across a child process, an LLM call or an embedding call. `connect` uses Python's default deferred transactions, so the `with conn:` block is the transaction; `store_analysis` runs inside the analyze step's block and never commits itself; `index_recording` embeds first and then opens its own single `with conn:`. Idempotency still holds: a step's delete and insert commit together or not at all.

## Review Focus
1. A retried upload after a dropped response → the same recording (200), one row, one audio file. (Task 3 test.)
2. Delete or retry while the worker holds the recording → 409 `recording_busy` / `not_failed`, nothing half-deleted; while a step is running, deleting another recording is not blocked by the worker. (Task 2 and Task 4 tests.)
3. A silent upload → `ready` with title "Untitled recording", empty analysis, no analyzer call. (Task 4 test.)
4. A server restart in the middle of `diarizing` → resumes at diarizing, decodes again because `audio.npy` is gone, never duplicates segments or speakers. (Task 4 test.)
5. A model output citing an unknown `[S n]` or an unknown speaker → item dropped and logged, owner set to null, never a crash. (Task 5 test.)

---

### Task 1: Read endpoints (library, detail, tags)

**Files:**
- Create: `backend/app/recordings/__init__.py`, `backend/app/recordings/read.py`
- Modify: `backend/app/api/routes/recordings.py` (`list_recordings`, `get_recording`), `backend/app/api/routes/tags.py` (`list_tags`)
- Test: `backend/tests/recordings/test_read.py`

**Interfaces:**
- Produces:
  - Consumes `get_db` (foundation Task 8: one connection per request, `check_same_thread=False`).
  - `recording_out(conn, row: sqlite3.Row) -> RecordingOut` (tags, `processing = bool(claimed)`, `waveform_peaks` parsed).
  - `list_recordings(conn, kind: RecordingKind | None, q: str | None, tag_ids: list[str]) -> list[RecordingOut]`: newest first; `q` matches title, tag names or any segment text (case-insensitive `LIKE`, `%` and `_` in `q` escaped); several `tag_id`s mean all of them.
  - `get_recording_detail(conn, rec_id: str) -> RecordingDetailOut`: segments in `idx` order; speakers with `display_name`; `summary` or `note` from `recordings.analysis` rendered with `render_analysis` (foundation Task 8); 404 `not_found` if missing.
  - `list_tags(conn) -> list[TagOut]`: name order, `count` = recordings using it.
  - Tests seed rows with `tests.seed.seed_recording` (foundation Task 8).

- [ ] **Step 1: Write the failing tests** (`client` fixture, seeded DB):
  - `test_list_newest_first_and_kind_filter`; `test_list_search_matches_title_tag_and_transcript` (three recordings, one match each); `test_search_escapes_like_wildcards` (`q="50%"` does not match everything); `test_list_tag_filter_requires_all_tags`.
  - `test_detail_renders_speaker_names_in_summary`: analysis text `"{{spk_X}} will send it"` with speaker renamed "Sarah" → `"Sarah will send it"`; unnamed → `"Speaker A will send it"`.
  - `test_detail_unknown_id_is_404_contract_shape`.
  - `test_tags_with_counts`.
- [ ] **Step 2: Run** `uv run pytest tests/recordings -v` → FAIL.
- [ ] **Step 3: Implement** `app/recordings/read.py` and the three handlers.
- [ ] **Step 4: Run** → PASS; `uv run ruff check . && uv run ruff format --check . && uv run pyright` clean; `uv run python -m app.cli export-openapi --check` still passes (no API shape change).
- [ ] **Step 5: Commit** `feat(backend): add library, detail and tags endpoints`.

### Task 2: Edit endpoints (title and tags, speaker rename, delete, retry)

**Files:**
- Create: `backend/app/recordings/edit.py`, `backend/app/audio/__init__.py`, `backend/app/audio/storage.py`
- Modify: `backend/app/api/routes/recordings.py` (`update_recording`, `rename_speaker`, `delete_recording`, `retry_recording`)
- Test: `backend/tests/recordings/test_edit.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `app.audio.storage`: `audio_path(data_dir: Path, rec_id: str, ext: str) -> Path`, `tmp_dir(data_dir: Path, rec_id: str) -> Path`, `remove_recording_files(data_dir: Path, rec_id: str, ext: str) -> None` (missing files are fine).
  - `update_recording(conn, rec_id, patch: RecordingPatchIn) -> RecordingOut`: only `ready` (else 409 `not_ready`); title trimmed, empty → 422 `validation_error`; tags normalised with `normalize_tag`, reused with `match_existing_tag`, duplicates removed, replace the set; unused tag rows are kept.
  - `rename_speaker(conn, rec_id, speaker_id, patch: SpeakerPatchIn) -> SpeakerOut`: only `ready`; trimmed; `""` clears the name; a speaker of another recording → 404.
  - `delete_recording(conn, data_dir, rec_id) -> None`: `DELETE FROM recordings WHERE id=? AND claimed=0`; 0 rows and the row exists → 409 `recording_busy`; 0 rows and no row → 404; then `remove_recording_files`.
  - `retry_recording(conn, rec_id) -> RecordingOut`: only `failed` (else 409 `not_failed`); sets `status` from `failed_step` (`decoding` → `uploaded`, others → the step's own status), clears `error_*` and `failed_step`, `claimed=0`; the route then calls `wake_worker(container)` (Task 4 provides it; until then a no-op function in `app/processing/__init__.py`).

- [ ] **Step 1: Write the failing tests:**
  - `test_patch_title_and_tags_reuses_existing` ("Budgets " with existing "budget" → `["budget"]`); `test_patch_not_ready_is_409`.
  - `test_rename_then_detail_shows_name`; `test_rename_empty_clears`; `test_rename_other_recordings_speaker_is_404`.
  - `test_delete_removes_rows_and_files` (audio file and tmp dir created in the test are gone; chunks gone).
  - `test_delete_claimed_is_409_and_keeps_everything`.
  - `test_retry_maps_failed_step_to_status` (table-driven: decoding→uploaded, transcribing→transcribing, diarizing→diarizing, analyzing→analyzing, indexing→indexing); `test_retry_not_failed_is_409`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add recording edit, delete and retry endpoints`.

### Task 3: Upload, decode and audio serving

**Files:**
- Create: `backend/app/audio/upload.py`, `backend/app/audio/decode.py`, `backend/tests/fixtures/` (generated in tests, not committed binaries)
- Modify: `backend/pyproject.toml` (add `av>=19,<20`), `backend/app/api/routes/recordings.py` (`upload_recording`, `get_recording_audio`)
- Test: `backend/tests/audio/test_upload.py`, `backend/tests/audio/test_decode.py`, `backend/tests/audio/test_serve.py`

**Interfaces:**
- Produces:
  - `ALLOWED_EXTENSIONS = {"m4a", "mp4", "aac", "wav", "mp3"}` (expo-audio's Android preset writes m4a).
  - `store_upload(conn, data_dir, *, kind, client_upload_id, file: UploadFile, max_bytes) -> tuple[RecordingOut, bool]` (bool = created): an existing `client_upload_id` returns that recording and `False` (Starlette has already spooled the multipart body before the handler runs, so the size limit applies while copying, not to the network transfer); otherwise copies to `<data_dir>/tmp/upload-<uuid>` counting bytes (over `max_bytes` → delete temp, 413 `payload_too_large`), moves to `audio_path`, then inserts the row; an `IntegrityError` on `client_upload_id` (the same upload arriving twice at once) returns the existing recording and deletes this request's file (`status='uploaded'`, `audio_ext`, `created_at` UTC). Unknown extension → 415 `unsupported_media_type`. Any failure leaves no row and no file.
  - Route: 201 when created, 200 when existing (set `response.status_code`); calls `wake_worker` after creating.
  - `DecodedAudio(duration_ms: int, peaks: list[float])`; `decode_to_npy(src: Path, dest: Path) -> DecodedAudio`: PyAV decode, resample to 16 kHz mono float32, `np.save`; peaks = 96 bucket maxima of `abs(samples)` scaled to 0–1 by the overall max (all zeros → all 0.0); raises `AudioUnreadable` on any decode error.
  - Audio route: `FileResponse` with the right media type (`audio/mp4` for m4a/mp4/aac, `audio/wav`, `audio/mpeg`); Starlette serves `Range` with 206. 404 if missing.

- [ ] **Step 1: Write the failing tests** (tests generate a 2 s sine wav and a short m4a with PyAV into `tmp_path`):
  - `test_upload_creates_recording_201`; `test_upload_same_client_id_returns_existing_200` (one row, one file); `test_concurrent_duplicate_client_id_keeps_one_file` (the row inserted between copy and insert via monkeypatch → existing returned, this request's file removed); `test_upload_too_large_413_leaves_nothing` (setting `upload_max_bytes=1000`); `test_upload_unknown_extension_415`.
  - `test_decode_m4a_to_16k_mono` (shape ≈ 32 000 samples, float32, `duration_ms ≈ 2000`, 96 peaks within 0–1); `test_decode_silence_peaks_zero`; `test_decode_garbage_raises_audio_unreadable`.
  - `test_audio_range_returns_206_with_content_range`; `test_audio_full_200`; `test_audio_missing_404`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add upload, decode and audio range serving`.

### Task 4: Worker, pipeline, claim, resume and failures

**Files:**
- Create: `backend/app/processing/worker.py`, `backend/app/processing/pipeline.py`, `backend/app/processing/speakers.py`
- Modify: `backend/app/container.py` (add `worker: "Worker | None" = None` as the last field, `Worker` imported under `TYPE_CHECKING` to avoid an import cycle), `backend/app/processing/__init__.py` (real `wake_worker`), `backend/app/api/app.py` (`create_app(container, *, start_worker: bool = False)` with a lifespan that starts and stops the worker), `backend/app/cli.py` (`serve` passes `start_worker=True`)
- Test: `backend/tests/processing/test_pipeline.py`, `backend/tests/processing/test_speakers.py`, `backend/tests/processing/test_worker.py`

**Interfaces:**
- Consumes: Tasks 2–3; `container.asr`, `container.diarizer`, `container.analyzer`; Task 5's `store_analysis` and `index_recording` (stubbed by Task 4 as steps that only advance status; Task 5 replaces their bodies).
- Import cycles: `app/container.py` imports `app.processing.fakes`, which runs `app/processing/__init__.py` first. So `app/processing/__init__.py` (`wake_worker`) must not import the worker, the pipeline or the container at module level: `Container`/`Worker` only under `TYPE_CHECKING`, and any runtime import late, inside the function.
- Produces:
  - `assign_speakers(segments: list[AsrSegment], turns: list[DiarTurn]) -> list[str]`: per segment, the turn speaker with the largest overlap, else the nearest turn's speaker; returns labels `A`, `B`… by first appearance.
  - `StepError(code: ErrorCode, message: str)`.
  - `process_recording(container: Container, conn, rec_id: str) -> None`: runs from the recording's current status to `ready`. Each step follows the Global Constraints rule: slow work first with no transaction open, then one short `with conn:` that deletes the step's old output, inserts the new output and sets the next status. Steps: decode (status `transcribing`; writes `audio.npy`, then stores `duration_ms`, `waveform_peaks`), transcribe (ASR child first; then segments in one transaction; zero segments → in that same transaction: title "Untitled recording", no tags, `analysis` = an empty `MeetingSummary(overview="", decisions=[], action_items=[], open_questions=[])` for meetings or `NoteContent(key_points=[], clean_text="")` for notes (so the app shows its empty state, never null), status `ready` with `claimed=0` (the pipeline then deletes the tmp dir); no diarize, analyze or index), diarize (meetings; diarizer child first, then speakers + `segments.speaker_id` in one transaction), analyze, index; any step that needs audio decodes first if `audio.npy` is missing. A `StepError` or any exception sets `failed`, `failed_step`, code (`audio_unreadable`, `transcription_failed`, `diarization_failed`, `analysis_failed`, `indexing_failed`) and a human message; details only in the log. `ready` or `failed` clears `claimed` and deletes the tmp dir.
  - `claim_next(conn) -> str | None`: oldest unclaimed non-terminal recording, claimed with `UPDATE … SET claimed=1 WHERE id=? AND claimed=0 AND status NOT IN ('ready','failed')` inside its own `with conn:` (committed before it returns, so no transaction stays open while the recording is processed).
  - `recover_on_startup(conn) -> None`: clears every `claimed` flag.
  - `class Worker(container)`: `start()` (runs `recover_on_startup`, then a daemon thread with its own connection), `stop()`, `wake()`, `run_once() -> bool` (claims and processes one recording; used by tests). `wake_worker(container)` reaches the running worker through the container (`container.worker: Worker | None`, a new optional field defaulting to `None`).

- [ ] **Step 1: Write the failing tests** (fakes from the `container` fixture; audio fixtures from Task 3):
  - `test_assign_speakers_overlap_and_nearest`; `test_labels_by_first_appearance`.
  - `test_meeting_reaches_ready_with_speakers_and_segments`; `test_note_skips_diarize`.
  - `test_silent_recording_ready_untitled_without_analyzer_call`: the container's `asr` replaced (`dataclasses.replace`) by an ASR that returns `[]` for any input (`FakeAsr` returns `[]` only for zero samples); → `ready`, title "Untitled recording", no tags, `analysis` equals the empty `MeetingSummary` (and, for a note, the empty `NoteContent`); analyzer spy not called.
  - `test_worker_holds_no_write_lock_during_slow_step`: the ASR is replaced by one that blocks on a `threading.Event`; the worker runs `run_once` in a thread; while it blocks, `DELETE /recordings/{id}` of another, unclaimed recording returns 204 and `DELETE` of the claimed one returns 409 `recording_busy`, each in < 1 s; then the event is set and the claimed recording reaches `ready`.
  - `test_resume_at_diarizing_after_restart_redecodes` (status `diarizing`, `claimed=1`, no `audio.npy`; `recover_on_startup` then `run_once` → `ready`; segment and speaker counts equal a clean run).
  - `test_step_failure_sets_failed_step_and_code` (diarizer raising → `failed`, `failed_step="diarizing"`, `diarization_failed`, `claimed=0`, tmp dir gone); then `retry` + `run_once` → `ready`.
  - `test_run_once_returns_false_when_queue_empty`; `test_one_failure_does_not_stop_the_queue`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): add processing worker with claim, resume and retry`.

### Task 5: Storing the analysis, chunking and indexing

**Files:**
- Create: `backend/app/processing/analysis_store.py`, `backend/app/rag/chunker.py`, `backend/app/rag/index.py`
- Modify: `backend/app/processing/pipeline.py` (analyze and index steps call these)
- Test: `backend/tests/processing/test_analysis_store.py`, `backend/tests/rag/test_chunker.py`, `backend/tests/rag/test_index.py`

**Interfaces:**
- Consumes: Task 4; `container.analyzer`, `container.embedder`; `app.domain.speakers`, `app.domain.tags`; `pack_embedding` (foundation Task 8).
- Produces:
  - `build_analysis_request(conn, rec_id) -> AnalysisRequest` (lines numbered `s = 1..n` in segment order, `speaker_label` for meetings, the 40 most used tags as vocabulary).
  - The analyze step calls `container.analyzer.analyze(...)` with no transaction open, then calls `store_analysis` and sets status `indexing` inside one `with conn:`.
  - `store_analysis(conn, rec_id, analysis: MeetingAnalysis | NoteAnalysis) -> None` (runs inside the caller's transaction; never commits): S numbers → `Citation(recording_id, segment_id, start_ms)`; unknown S numbers removed and logged; items left without a citation removed and logged; `owner` label → `owner_speaker_id` (unknown → `None`, logged); `tokenize_speakers` on every text; tags normalised and reused (`match_existing_tag` against existing tag names), at most 4; writes `title`, tags and `recordings.analysis` (`MeetingSummary` / `NoteContent` JSON).
  - `SegmentRow(id: str, idx: int, start_ms: int, end_ms: int, speaker_label: str | None, text: str)` (frozen dataclass; `speaker_label` is `None` for notes); `load_segment_rows(conn, rec_id) -> list[SegmentRow]` in `idx` order.
  - `ChunkDraft(first_idx: int, last_idx: int, start_ms: int, end_ms: int, text: str)`; `chunk_segments(segments: list[SegmentRow], kind: RecordingKind, max_tokens: int, min_tokens_at_speaker_change: int) -> list[ChunkDraft]` per processing spec §5 (≈ chars/4 tokens, never split a segment, end at a speaker change once ≥ min, one-segment overlap, `Speaker B: …` lines for meetings, plain text for notes).
  - `index_recording(conn, embedder, rec_id, settings) -> int`: reads the segments, chunks them and calls `embed_passages` in one batch with no transaction open; then in one `with conn:` deletes the recording's old chunks, inserts the new ones and sets status `ready` with `claimed=0`; returns the count (the pipeline then deletes the tmp dir).

- [ ] **Step 1: Write the failing tests:**
  - `test_store_maps_s_numbers_to_citations`; `test_store_drops_unknown_s_and_empty_items_and_logs` (`caplog`); `test_store_owner_label_to_speaker_id_unknown_null`; `test_store_tokenizes_speakers_then_detail_renders_names`; `test_store_tags_reuse_and_cap_4`.
  - `test_chunks_never_split_segments_and_overlap_one`; `test_meeting_chunk_ends_at_speaker_change_after_min`; `test_long_single_segment_is_its_own_chunk`; `test_note_chunks_plain_text`.
  - `test_index_replaces_chunks_and_vec_distance_works`: after indexing, `SELECT vec_distance_cosine(embedding, ?)` with the same text's fake vector returns ≈ 0 for that chunk.
  - Pipeline: `test_meeting_ready_has_summary_and_chunks` (fake analyzer citing `[1]`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, checks clean.
- [ ] **Step 5: Commit** `feat(backend): store analysis output and index recordings`.

### Task 6: Real embedder

**Files:**
- Create: `backend/app/rag/fastembed_embedder.py`
- Modify: `backend/pyproject.toml` (base adds `fastembed>=0.9,<0.10`), `backend/uv.lock`, `backend/app/container.py` (embedder binding point), `backend/app/api/routes/health.py` (local readiness of the embedder), `backend/tests/conftest.py` (the `container` fixture keeps fakes)
- Test: `backend/tests/rag/test_fastembed_embedder.py`, `backend/tests/test_container.py` (extend)

**Interfaces:**
- Consumes: Task 5 (indexing calls `container.embedder`).
- Produces:
  - `FastEmbedEmbedder(model_id: str, cache_dir: Path)`: `dim = 384`; constructing it touches nothing (no download, no model load): the `TextEmbedding` is created on the first `embed_*` call, because `build_container` runs in CI (`export-openapi --check`); `embed_passages` → `TextEmbedding.embed`; `embed_query` prepends `"Represent this sentence for searching relevant passages: "` (fastembed 0.9 does not).
  - `build_container`: the embedder is `FastEmbedEmbedder` in both speech modes.
  - `tests/conftest.py`: once real classes are bound, the `container` fixture would download models (or, after the agents plan binds the Summarizer, raise `ConfigError` without keys) as soon as a test indexes or analyzes. The fixture therefore returns `dataclasses.replace(result, embedder=FakeEmbedder(), analyzer=FakeAnalyzer())` (speech is already fake there through `SPEECH_BACKEND=fake`); migrations run on `result.db_path` as before. If the agents plan merged first, its Task 2 already added this `replace` with `analyzer=` only: add `embedder=` to the same call (one `replace`, both fakes).
  - `/health` local role `embedder`: ready if its model files are in the cache dir.

- [ ] **Step 1: Write the failing tests** (no network):
  - `test_constructing_embedder_touches_no_network` (monkeypatch `TextEmbedding` to raise if called; constructing and `build_container` succeed).
  - `test_embed_query_adds_bge_prefix` (monkeypatch `TextEmbedding` with a recorder; asserts the exact prefix, and that passages have none).
  - `test_container_binds_fastembed_embedder`; `test_fixture_container_uses_fakes` (the `container` fixture's `embedder` is a `FakeEmbedder`, `analyzer` a `FakeAnalyzer`).
  - `test_health_embedder_ready_when_cached` (files present in a temp cache dir → ready; absent → not ready).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, then `uv lock`.
- [ ] **Step 4: Run** the suite, ruff, pyright → clean.
- [ ] **Step 5: Commit** `feat(backend): bind the fastembed embedder`.

### Task 7: Real speech in child processes, setup command

**Files:**
- Create: `backend/app/speech/child.py` (runner), `backend/app/speech/asr_child.py`, `backend/app/speech/diarize_child.py`, `backend/app/speech/real.py`, `backend/tests/speech/echo_child.py` (test-only child)
- Modify: `backend/pyproject.toml` (speech extra, torch index), `backend/uv.lock`, `backend/app/container.py` (speech binding point), `backend/app/api/routes/health.py` (ASR and diarizer readiness), `backend/app/cli.py` (`setup`), `docs/setup.md` (speech, Hugging Face, model download sections), `AGENTS.md` (Backend commands: laptop install line)
- Test: `backend/tests/speech/test_child_runner.py`, `backend/tests/test_container.py` (extend)

**Interfaces:**
- Consumes: Tasks 4 and 6.
- Produces:
  - `pyproject.toml`: optional extra `speech = ["faster-whisper==1.2.1", "pyannote.audio==4.0.7", "torch==2.10.0", "torchaudio==2.10.0"]` and the torch index (proven with torch 2.10.0+cu128 and pyannote 4.0.7 on the demo laptop; macOS uses PyPI through the marker):
    ```toml
    [tool.uv.sources]
    torch = { index = "pytorch-cu128", marker = "sys_platform != 'darwin'" }
    torchaudio = { index = "pytorch-cu128", marker = "sys_platform != 'darwin'" }

    [[tool.uv.index]]
    name = "pytorch-cu128"
    url = "https://download.pytorch.org/whl/cu128"
    explicit = true
    ```
  - `run_child(module: str, args: list[str], *, timeout_s: float, env: Mapping[str, str]) -> dict[str, object]`: `subprocess.run([sys.executable, "-m", module, *args, "--out", <tmp json>], timeout=…)`; non-zero exit or timeout → `ChildFailed(returncode | None)`; stderr goes to the server log only; returns the parsed JSON.
  - Child modules: `asr_child --audio <npy> --model <id> --device <d> --compute <c>` writes `{"segments": [{start_ms, end_ms, text}]}` (faster-whisper `language="en"`, `vad_filter=True`, `condition_on_previous_text=False`); `diarize_child --audio <npy> --model <id> --device <d>` writes `{"turns": [{start_ms, end_ms, speaker}]}` (pyannote gets `{"waveform": tensor, "sample_rate": 16000}`, never a path; token from `HF_TOKEN`). In `asr_child.main()`: on Windows only, `os.add_dll_directory(<sys.prefix>/Lib/site-packages/torch/lib)` before importing faster-whisper.
  - Pyright strict without the speech extra (CI installs only the base dependencies): no module-level import of `faster_whisper`, `pyannote.audio` or `torch` anywhere. Each child module imports them inside its `main()`, each import line carrying `# pyright: ignore[reportMissingImports]  -- optional speech extra not installed in CI` (a third-party boundary, rule named). Values from those libraries are unknown to pyright, so they cross into typed code in one place per child: a small loop that builds typed dataclasses (`ChildSegment(start_ms: int, end_ms: int, text: str)`, `ChildTurn(start_ms: int, end_ms: int, speaker: str)`) with explicit `int(...)`/`str(...)` conversions, under that same per-line rule where pyright reports `reportUnknownMemberType`/`reportUnknownVariableType`/`reportUnknownArgumentType` on a library value; nothing past that loop touches a library object. The parent (`real.py`) imports nothing heavy; it validates the child's JSON into `AsrSegment`/`DiarTurn`.
  - `RealAsr(models, settings)` / `RealDiarizer(models, settings)` implementing the protocols via `run_child` with `env = {**os.environ, "HF_HOME": str(model_cache_dir / "hf")}`: always the full parent environment (on Windows a child without `SYSTEMROOT` dies at startup; it also carries `PATH`, CUDA variables, `HF_TOKEN` and `HF_HUB_OFFLINE`), never a minimal mapping; `ChildFailed` → `StepError` in the pipeline. The pipeline calls them with no transaction open (Global Constraints).
  - `build_container`: `speech_backend == "real"` → `RealAsr`, `RealDiarizer`, `speech_backend_bound="real"`. The test fixture is unaffected: it sets `SPEECH_BACKEND=fake` (and Task 6's `replace` keeps the embedder and analyzer fake).
  - `/health` local roles `asr`/`diarizer`: `"fake"` when fake is bound, else ready if model files are cached (and `HF_TOKEN` for the diarizer).
  - `python -m app.cli setup`: creates data and cache dirs, downloads the embedder, and when the speech extra is importable downloads the ASR and diarizer models; prints each role's readiness and missing env vars; never prints values.
  - `AGENTS.md` Backend commands: laptop install line `uv sync --extra speech`.

- [ ] **Step 1: Write the failing tests** (no network, no torch):
  - `test_run_child_passes_full_environment` (echo child writes back whether `PATH` is set and the value of `HF_HOME`).
  - `test_run_child_returns_json` / `test_run_child_nonzero_exit_raises` / `test_run_child_timeout_kills_and_raises` using `tests.speech.echo_child` (`--mode ok|fail|hang`).
  - `test_container_binds_real_speech_when_configured` (monkeypatch the classes; `speech_backend_bound == "real"`).
  - `test_child_modules_import_without_speech_extra` (importing `app.speech.asr_child` and `app.speech.diarize_child` succeeds without torch installed: heavy imports happen only in `main()`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, then `uv lock`.
- [ ] **Step 4: Run** the suite, ruff, pyright → clean in the normal dev environment; then check the CI case: `uv sync --locked` (no extra) followed by `uv run pyright` passes, and `uv sync --locked` in CI still works without the extra.
- [ ] **Step 5 (manual, lead's laptop; in the plan issue's lead checklist):** `uv sync --extra speech`, `uv run python -m app.cli setup` → every role ready; `serve`; upload a 1-minute two-person recording with `curl -F`; it reaches `ready` with two speakers. Record timings (decode, ASR, diarization) in the plan issue.
- [ ] **Step 6: Commit** `feat(backend): run real speech in child processes and add the setup command`.

## Shared files with the agents plan
Both this plan and the agents plan edit `backend/app/container.py` (binding points), `backend/tests/conftest.py` (the fixture's `dataclasses.replace` with fakes; the agents plan also sets `chat_runs` there), `backend/app/cli.py`, `docs/setup.md`, `backend/pyproject.toml` and `backend/uv.lock`, and may touch `backend/app/api/app.py`. Whichever merges second rebases and keeps both changes. A `uv.lock` conflict is resolved by taking either side and re-running `uv lock`, never by hand-merging the file.

## Self-review notes
- Spec coverage: pipeline and claim/resume/retry (processing §1, §6) Tasks 2 and 4; speech execution (§2) Task 7; embedder (§5) Task 6; analysis storage (§4, server part) Task 5; chunking and indexing (§5) Task 5; upload limits and idempotency (data-API §4) Task 3; routes owned by this plan (overview) Tasks 1–3; installs and setup (platform §2) Tasks 6 and 7. The `Analyzer` (prompts, failover, map-reduce) is the agents plan.
- Dependencies: Task 1 none; Task 2 needs 1; Task 3 needs 1; Task 4 needs 2 and 3; Task 5 needs 4; Task 6 needs 5; Task 7 needs 4 and 6. Tasks 2 and 3 can run in parallel. Mobile can use real data from Task 1 (seeded) and Task 3 (uploads).
