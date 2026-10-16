# Stage 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze everything the four parallel stage 1 plans share (schema, every API route and model, `openapi.json`, backend protocols and fakes, mobile scaffold, theme, API client, CI) so they can be built side by side from Saturday morning.

**Architecture:** A FastAPI app built by `create_app(container)` from a composition root; routes have their final request and response models but stub handlers (501 `not_implemented`) except `/health`. SQLite with migration `001` holding the full stage 1 schema. Speech, embedder and analysis sit behind protocols with fakes. The Expo app has its providers, theme, custom tab bar and a typed API client generated from `openapi.json`.

**Tech Stack:** Python 3.12, uv, FastAPI 0.143, Pydantic 2, pydantic-settings, PyYAML, platformdirs, python-ulid, sqlite-vec 0.1.9, numpy, pytest, httpx, ruff, pyright; Expo SDK 58, expo-router, React Native Paper 5, TanStack Query 5, AsyncStorage, openapi-typescript, jest-expo, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design.md`, mainly `…-design-data-api.md` (schema, routes, errors), `…-design-ui.md` §1 and §4 (navigation, tokens), `…-design-platform.md` §1–§3 (config, installs, security).

**Stage overview (global constraints, review focus, ownership):** `docs/superpowers/plans/2026-10-16-stage-1-overview.md`. Every task's requirements include its Global constraints.

## Global Constraints (this plan)
- Everything in the overview's Global constraints.
- The server binds `127.0.0.1` by default; `bind_host` is a setting.
- Every API error, including FastAPI's own 422 and `HTTPException`, uses `{"error": {"code", "message"}}`; codes come from the closed enum in the data-API spec §5 (with `not_implemented`).
- IDs: prefix + 26-character ULID (`rec_`, `seg_`, `spk_`, `chk_`, `tag_`, `cht_`, `msg_`).
- Mobile reads the app name only through `expo-constants` `extra` set by `mobile/app.config.ts` from `config/app.json`; app code never imports `../config/`.

## Review Focus
1. A stub route called by the app → 501 in the contract shape with `not_implemented`, never a FastAPI default body. (Task 4 test.)
2. `models.yaml` with a `base_url` containing credentials, or a missing role → startup refuses with a clear message naming the role or provider, never echoing the URL. (Task 1 test.)
3. Deleting a recording row cascades to speakers, segments, chunks and tag links (foreign keys actually on). (Task 2 test.)
4. Settings or registry objects printed or logged → keys never appear (`SecretStr`, no key values in reprs). (Task 1 test.)
5. A server URL typed with spaces, a trailing slash or `http://` → stored normalised; `http://` flagged as "not HTTPS" by the client helper. (Task 7 test.)

---

### Task 1: Backend project, settings and config loading

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/ids.py`, `backend/app/config/__init__.py`, `backend/app/config/settings.py`, `backend/app/config/app_config.py`, `backend/app/config/models_registry.py`, `backend/.env.example`, `config/app.json`, `config/models.yaml`
- Test: `backend/tests/test_ids.py`, `backend/tests/config/test_settings.py`, `backend/tests/config/test_app_config.py`, `backend/tests/config/test_models_registry.py`

**Interfaces:**
- Produces:
  - `new_id(prefix: Literal["rec", "seg", "spk", "chk", "tag", "cht", "msg"]) -> str` → `"rec_01J…"` (prefix + `_` + 26-char ULID).
  - `Settings` (pydantic-settings, env prefix none, reads `backend/.env`): `data_dir: Path`, `model_cache_dir: Path`, `bind_host: str = "127.0.0.1"`, `port: int = 8000`, `speech_backend: Literal["real", "fake"] = "real"`, `upload_max_bytes: int = 200_000_000`, `chunk_max_tokens: int = 200`, `chunk_min_tokens_at_speaker_change: int = 80`, `retrieval_k: int = 8`, `retrieval_max_distance: float = 0.6` (permissive, provisional; calibrated by the agents plan), `chat_deadline_s: float = 75`, `speech_step_timeout_s: float = 1800`, `asr_device: str | None = None`, `diarizer_device: str | None = None`. No per-provider key fields: keys are found through `key_env`. `data_dir` default: `platformdirs.user_data_dir(<slug of app name>)`; `model_cache_dir` default: `<data_dir>/models`.
  - `load_settings(app: AppConfig, env_file: Path = <repo>/backend/.env) -> Settings`: first loads `env_file` into `os.environ` without overriding variables already set (so `key_env` lookups and child processes see the keys), then builds `Settings`.
  - `provider_key(registry: ModelsRegistry, provider: str) -> SecretStr | None` reads `os.environ[registry.providers[provider].key_env]`; `hf_token() -> SecretStr | None` reads `HF_TOKEN`. These are the only places keys are read.
  - `AppConfig(name: str, version: str)` and `load_app_config(path: Path = <repo>/config/app.json) -> AppConfig`.
  - `ModelsRegistry` with `providers: dict[str, Provider]` (`base_url: HttpUrl`, `key_env: str`) and `roles: Roles` where `llm` and `llm_analysis` are `list[LlmEntry]` (min 1; `provider`, `model`, `reasoning: dict[str, str | int] = {}`, `max_request_tokens: int`, `timeout_s: float`), `embedder: LocalModel`, `asr: LocalModel`, `diarizer: LocalModel` (`model`, `device: str`, `compute_type: str | None = None`). `load_models_registry(path: Path, settings: Settings) -> ModelsRegistry` applies `asr_device` / `diarizer_device` overrides (cpu → `compute_type="int8"` for asr).
  - `ConfigError(Exception)` for every load failure.

- [ ] **Step 1: Create the uv project.** `uv init --app --no-workspace --python 3.12 backend` (non-interactive); delete the generated `main.py`; then `uv add fastapi~=0.143 "uvicorn[standard]" pydantic-settings pyyaml platformdirs python-ulid "sqlite-vec==0.1.9" numpy python-multipart` and `uv add --dev pytest httpx ruff pyright`. Set `[tool.pytest.ini_options] pythonpath = ["."]` (an `--app` project is not installed, so tests need it to `import app`). Configure ruff (line length 120, rule sets `E,F,I,B,UP,S,SIM,RUF`; `S101` allowed in `tests/` via per-file config) and pyright strict for `app` and `tests` in `pyproject.toml`. The speech extra is added by the processing plan, not here.
- [ ] **Step 2: Write `config/app.json`** with the working name from `project_knowledge.md` as `name` and `"version": "0.1.0"`, and `config/models.yaml` with the initial picks of platform spec §1: providers `groq` (`https://api.groq.com/openai/v1`, `GROQ_API_KEY`) and `gemini` (`https://generativelanguage.googleapis.com/v1beta/openai/`, `GEMINI_API_KEY`); `llm`: groq `openai/gpt-oss-20b` then gemini Flash; `llm_analysis`: gemini Flash then groq `openai/gpt-oss-120b`; `embedder` `BAAI/bge-small-en-v1.5` cpu; `asr` `distil-large-v3` cuda `int8_float16`; `diarizer` `pyannote/speaker-diarization-community-1` cuda. Use `gemini-flash-latest` as the Gemini id for now (the agents plan confirms ids). `.env.example` lists `GROQ_API_KEY=`, `GEMINI_API_KEY=`, `HF_TOKEN=`, `SPEECH_BACKEND=`, `ASR_DEVICE=`, `DIARIZER_DEVICE=`.
- [ ] **Step 3: Write the failing tests.**
  - `test_new_id_format`: `re.fullmatch(r"rec_[0-9A-HJKMNP-TV-Z]{26}", new_id("rec"))`; two calls differ.
  - `test_load_app_config_reads_name` (tmp file) and `test_load_app_config_missing_name_raises_config_error`.
  - `test_registry_loads_repo_models_yaml`: loading the committed `config/models.yaml` succeeds and `roles.llm[0].provider == "groq"`.
  - `test_registry_refuses_credentials_in_base_url`: `base_url: https://user:pass@x.io/v1` → `ConfigError`, and `"pass"` not in `str(err)`.
  - `test_registry_missing_role_names_it`: no `llm_analysis` → `ConfigError` whose message contains `"llm_analysis"`.
  - `test_registry_unknown_provider_in_role` → `ConfigError`.
  - `test_asr_device_override_cpu`: settings `asr_device="cpu"` → `roles.asr.device == "cpu"` and `compute_type == "int8"`.
  - `test_env_file_reaches_os_environ`: a temp `.env` with `GROQ_API_KEY=sk-secret` and no such env var set (`monkeypatch.delenv`); after `load_settings`, `provider_key(registry, "groq")` returns it, and an already-set env var is not overridden.
  - `test_keys_never_in_reprs`: `"sk-secret" not in repr(provider_key(...))`, not in `repr(settings)` and not in `repr(registry)`.
  - `test_settings_defaults_bind_localhost`: `bind_host == "127.0.0.1"`.
- [ ] **Step 4: Run** `cd backend && uv run pytest tests/test_ids.py tests/config -v` → FAIL (modules missing).
- [ ] **Step 5: Implement** the modules with the signatures above. The credentials check rejects any `base_url` whose parsed URL has a username or password, and its message names the provider only.
- [ ] **Step 6: Run** the same tests → PASS; `uv run ruff check . && uv run ruff format --check . && uv run pyright` → clean.
- [ ] **Step 7: Commit** `feat(backend): add project, settings and config loading`.

### Task 2: Database and migration 001

**Files:**
- Create: `backend/app/db/__init__.py`, `backend/app/db/connection.py`, `backend/app/db/migrate.py`, `backend/app/db/migrations/001_initial.sql`
- Test: `backend/tests/db/test_migrate.py`

**Interfaces:**
- Consumes: `Settings.data_dir` (Task 1).
- Produces:
  - `connect(db_path: Path) -> sqlite3.Connection`: `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `row_factory=sqlite3.Row`, sqlite-vec loaded (`sqlite_vec.load(conn)` after `enable_load_extension(True)`, then disabled again).
  - `apply_migrations(conn: sqlite3.Connection) -> list[str]`: applies `migrations/NNN_*.sql` not yet in table `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT)`, in order, each in a transaction; returns the versions applied.
  - Schema exactly as data-API spec §1: tables `recordings` (incl. `claimed INTEGER NOT NULL DEFAULT 0`, `client_upload_id TEXT NOT NULL UNIQUE`, `status` CHECK in the seven statuses, `kind` CHECK in `meeting`/`note`), `speakers`, `segments` (`idx` with `UNIQUE(recording_id, idx)`), `chunks` (`embedding BLOB NOT NULL`), `tags` (`name UNIQUE`), `recording_tags`, `chats`, `messages` (`role` CHECK). Children reference their recording or chat with `ON DELETE CASCADE`. Within a recording: `segments.speaker_id → speakers(id) ON DELETE SET NULL`; `chunks.first_segment_id` / `last_segment_id → segments(id) ON DELETE CASCADE`; `speakers` has `UNIQUE(recording_id, label)`. (This lets a resumed or retried step delete its own partial output; stage 1 adds no migration after `001`.) Indexes: `segments(recording_id, idx)`, `chunks(recording_id)`, `recordings(status, claimed)`, `messages(chat_id, created_at)`.

- [ ] **Step 1: Write the failing tests.**
  - `test_apply_migrations_creates_all_tables` (tmp path): table names ⊇ the nine tables; second call returns `[]`.
  - `test_foreign_keys_on_and_cascade`: insert a recording with a speaker, two segments, a chunk and a tag link; `DELETE FROM recordings` → all child rows gone, the tag row remains.
  - `test_deleting_speakers_nulls_segment_speaker`: delete a recording's speakers → its segments remain with `speaker_id IS NULL`.
  - `test_deleting_segments_removes_chunks`: delete a recording's segments → its chunks are gone.
  - `test_status_check_rejects_unknown_status` → `sqlite3.IntegrityError`.
  - `test_client_upload_id_unique` → `sqlite3.IntegrityError` on duplicate.
  - `test_sqlite_vec_loaded`: `SELECT vec_distance_cosine(?, ?)` on two equal 3-float BLOBs (`struct.pack("3f", …)`) returns `0.0`.
- [ ] **Step 2: Run** `uv run pytest tests/db -v` → FAIL.
- [ ] **Step 3: Implement** `connect`, `apply_migrations` and `001_initial.sql`.
- [ ] **Step 4: Run** → PASS; ruff and pyright clean.
- [ ] **Step 5: Commit** `feat(backend): add database connection and initial schema`.

### Task 3: Protocols, fakes and composition root

**Files:**
- Create: `backend/app/speech/__init__.py`, `backend/app/speech/protocols.py`, `backend/app/speech/fakes.py`, `backend/app/rag/__init__.py`, `backend/app/rag/protocols.py`, `backend/app/rag/fakes.py`, `backend/app/agents/__init__.py`, `backend/app/agents/schemas.py`, `backend/app/processing/__init__.py`, `backend/app/processing/protocols.py`, `backend/app/processing/fakes.py`, `backend/app/container.py`, `backend/app/domain/__init__.py`, `backend/app/domain/types.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_fakes.py`, `backend/tests/test_container.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `app.domain.types`: `RecordingKind = Literal["meeting", "note"]`, `RecordingStatus = Literal["uploaded", "transcribing", "diarizing", "analyzing", "indexing", "ready", "failed"]` (API models in Task 4 reuse them).
  - `app.speech.protocols`: `AsrSegment(start_ms: int, end_ms: int, text: str)`, `DiarTurn(start_ms: int, end_ms: int, speaker: str)`; `class Asr(Protocol): def transcribe(self, audio_npy: Path) -> list[AsrSegment]`; `class Diarizer(Protocol): def diarize(self, audio_npy: Path) -> list[DiarTurn]`. (`audio_npy` = 16 kHz mono float32 `.npy`; the real implementations run child processes, processing plan.)
  - `app.speech.fakes`: `FakeAsr`, `FakeDiarizer` returning a fixed 6-segment, 2-speaker conversation scaled to the audio length (`np.load(path, mmap_mode="r").shape[0] / 16000`); an empty array → `[]`.
  - `app.rag.protocols`: `class Embedder(Protocol): dim: int; def embed_passages(self, texts: Sequence[str]) -> list[list[float]]; def embed_query(self, text: str) -> list[float]`. `app.rag.fakes.FakeEmbedder` (dim 384, deterministic hash-based unit vectors; the same text gives the same vector).
  - `app.agents.schemas`: the LLM output schemas exactly as processing spec §4 (`Item`, `ActionItem`, `MeetingAnalysis`, `NoteAnalysis`) and chat spec §3 (`ChatReply`), with their `Field` constraints.
  - `app.processing.protocols`: `TranscriptLine(s: int, speaker_label: str | None, text: str)`; `AnalysisRequest(kind: RecordingKind, lines: list[TranscriptLine], tag_vocabulary: list[str])`; `class Analyzer(Protocol): def analyze(self, request: AnalysisRequest) -> MeetingAnalysis | NoteAnalysis`. `app.processing.fakes.FakeAnalyzer`: title "Fake analysis", tags `["demo"]`, one item citing `[1]` per list (meeting) or one key point citing `[1]` plus `clean_text` = joined line text (note).
  - `app.container`: `@dataclass Container(settings: Settings, app_config: AppConfig, models: ModelsRegistry, db_path: Path, speech_backend_bound: Literal["real", "fake"], asr: Asr, diarizer: Diarizer, embedder: Embedder, analyzer: Analyzer)`; `build_container(settings: Settings) -> Container`. Binding points, marked by one comment each: when `speech_backend == "real"` the processing plan binds the real `Asr`/`Diarizer`/`Embedder`; the agents plan binds the real `Analyzer`. Until then `build_container` binds the fakes for every backend value and sets `speech_backend_bound="fake"`.
  - `tests/conftest.py`: `container` fixture (tmp data dir, fakes, migrated db), reused by every later backend plan; Task 4 adds the `client` fixture.

- [ ] **Step 1: Write the failing tests.**
  - `test_fake_asr_scales_to_audio` (10 s of zeros in a tmp `.npy`): segments sorted, last `end_ms <= 10_000`; empty array → `[]`.
  - `test_fake_embedder_deterministic_unit_vectors`: dim 384, norm ≈ 1, same input same output, different input different output.
  - `test_fake_analyzer_validates`: meeting request → `MeetingAnalysis` that passes its own model validation; note request → `NoteAnalysis` with `len(key_points) >= 1`.
  - `test_note_analysis_allows_one_key_point` and `test_item_requires_a_source` (`sources=[]` → `ValidationError`).
  - `test_build_container_uses_fakes_when_fake_backend`.
- [ ] **Step 2: Run** `uv run pytest -v` → FAIL.
- [ ] **Step 3: Implement** the modules.
- [ ] **Step 4: Run** the whole suite → PASS; ruff and pyright clean.
- [ ] **Step 5: Commit** `feat(backend): add protocols, fakes and composition root`.

### Task 4: API skeleton, CLI and openapi.json

**Files:**
- Create: `backend/app/api/__init__.py`, `backend/app/api/app.py`, `backend/app/api/errors.py`, `backend/app/api/deps.py`, `backend/app/api/models/{__init__,common,recordings,analysis,tags,chats,health}.py`, `backend/app/api/routes/{__init__,health,recordings,tags,chats}.py`, `backend/app/domain/analysis.py`, `backend/app/cli.py`, `backend/openapi.json`
- Modify: `backend/tests/conftest.py` (add the `client` fixture: `TestClient(create_app(container))`)
- Test: `backend/tests/api/test_errors.py`, `backend/tests/api/test_health.py`, `backend/tests/api/test_routes_exist.py`, `backend/tests/test_openapi_fresh.py`

**Interfaces:**
- Consumes: `Settings`, `AppConfig`, `ModelsRegistry` (Task 1); `connect`, `apply_migrations` (Task 2); `Container`, `container` fixture (Task 3).
- Produces:
  - `ErrorCode(StrEnum)`: exactly the data-API spec §5 list (incl. `not_implemented`). `ApiError(Exception)(status: int, code: ErrorCode, message: str)`. `ErrorBody` / `ErrorOut` models for the shape. Handlers for `ApiError`, `RequestValidationError` (422 → `validation_error`), `StarletteHTTPException` (404 → `not_found`, others → `internal_error`), and unhandled `Exception` (500 → `internal_error`, logged, generic message).
  - `not_implemented() -> NoReturn` raising `ApiError(501, ErrorCode.not_implemented, …)`.
  - `app.domain.analysis`: `Citation`, `AnalysisItem`, `AnalysisActionItem`, `MeetingSummary`, `NoteContent` exactly as data-API spec §2.
  - API models (Pydantic, `snake_case`, used as `response_model`): `RecordingOut` (using `RecordingKind` / `RecordingStatus` from Task 3) (id, kind, title, status, failed_step, error_code, error_message, created_at, duration_ms, tags: list[TagOut], waveform_peaks: list[float] | None, processing: bool (= claimed)); `SpeakerOut` (id, label, name, display_name); `SegmentOut` (id, idx, start_ms, end_ms, speaker_id, text); `RecordingDetailOut(RecordingOut)` + speakers, segments, `summary: MeetingSummary | None`, `note: NoteContent | None`; `RecordingPatchIn` (title: str | None = Field(None, max_length=60), tags: list[str] | None = Field(None, max_length=4)); `SpeakerPatchIn` (name: str = Field(max_length=40)); `TagOut` (id, name, count); `ChatOut` (id, created_at); `CitationOut` (n, recording_id, segment_id, start_ms, recording_title); `MessageOut` (id, role, text, reply_type, citations, created_at); `ChatDetailOut` (id, messages); `AskIn` (text: str = Field(min_length=1, max_length=2000), scope: Literal["notes","meetings","both"], tag_ids: list[str] = []); `RunAcceptedOut` (run_id); `RunOut` (status: Literal["running","done","failed"], steps: list[str], message: MessageOut | None, error: ErrorBody | None); `HealthOut` (app_name, version, speech_backend, roles: dict[str, str]).
  - Routes under `/api/v1`, paths, methods and status codes exactly as data-API spec §4. `POST /recordings` declares multipart `kind: Form`, `client_upload_id: Form`, `file: UploadFile`, responses 200 and 201 with `RecordingOut`. `GET /recordings/{id}/audio` declares `200`/`206` with `audio/*` content. All handlers except `/health` call `not_implemented()`. Each route has a stable `operation_id` (e.g. `list_recordings`, `upload_recording`, `get_run`) so generated client names do not change later.
  - `GET /health` is real: `roles` maps each role to `"ready"` or a reason, by presence checks only (`llm`/`llm_analysis`: the first entry's key env var set; `diarizer`: `hf_token()` set when the bound backend is real; local models: `"ready"` here, refined by the processing plan); `speech_backend` = `container.speech_backend_bound` (what is actually bound, not the setting).
  - `create_app(container: Container) -> FastAPI` with `title` from `AppConfig.name` and `version` from `AppConfig.version`; `get_container(request) -> Container` dependency in `deps.py`.
  - `app.cli`: `python -m app.cli serve` (creates the data dir, applies migrations, runs uvicorn on `bind_host:port`) and `python -m app.cli export-openapi [--check]` (writes `backend/openapi.json` sorted and indented; `--check` exits 1 if it differs). The processing plan adds `setup`.

- [ ] **Step 1: Write the failing tests.**
  - `test_stub_route_returns_contract_shape`: `GET /api/v1/recordings` → 501, body `{"error": {"code": "not_implemented", "message": …}}`.
  - `test_validation_error_shape`: `POST /api/v1/chats/cht_x/messages` with `{"text": ""}` → 422, `code == "validation_error"`, no `detail` key.
  - `test_unknown_path_shape`: `GET /api/v1/nope` → 404, `code == "not_found"`.
  - `test_unhandled_exception_is_generic` (client built with `TestClient(app, raise_server_exceptions=False)`): a test-only route raising `RuntimeError("secret path /x")` → 500, `code == "internal_error"`, `"secret" not in` body.
  - `test_health_reports_roles`: with no keys set → `roles["llm"] != "ready"` and mentions `GROQ_API_KEY`; with keys set → `"ready"`; `app_name` equals `config/app.json` name; with the setting `real` but fakes bound, `speech_backend == "fake"`; keys present only in a temp `.env` (not in the environment) still give `"ready"`.
  - `test_openapi_is_fresh`: `export-openapi --check` exits 0 (fails when `openapi.json` is stale).
  - `test_error_codes_in_openapi`: `openapi.json` has an `ErrorCode` schema whose enum equals every `ErrorCode` member (the mobile error mapping relies on it).
  - `test_routes_exist`: for each (method, path) in the data-API spec §4 table, `app.openapi()["paths"]` contains it; every operation has an `operationId`.
- [ ] **Step 2: Run** `uv run pytest tests/api -v` → FAIL.
- [ ] **Step 3: Implement** errors, models, routers, `create_app` and the CLI, then `uv run python -m app.cli export-openapi` to write `backend/openapi.json`.
- [ ] **Step 4: Run** the whole suite → PASS; ruff and pyright clean; `uv run python -m app.cli serve` starts and `curl http://127.0.0.1:8000/api/v1/health` answers (then stop it).
- [ ] **Step 5: Commit** `feat(backend): add API skeleton, CLI and openapi.json`.

### Task 5: Mobile scaffold, theme and tab bar

**Files:**
- Create: `mobile/` (create-expo-app output), `mobile/app.config.ts`, `mobile/app/_layout.tsx`, `mobile/app/(tabs)/_layout.tsx`, `mobile/app/(tabs)/{meetings,notes,chat,settings}.tsx`, `mobile/src/theme/{tokens,paperTheme,fonts,motion}.ts`, `mobile/src/components/TabBar.tsx`, `mobile/src/recording/RecordAction.tsx`, `mobile/src/config/appInfo.ts`, `mobile/eas.json`
- Test: `mobile/src/theme/tokens.test.ts`, `mobile/src/components/TabBar.test.tsx`

**Interfaces:**
- Produces:
  - `tokens`: `{ dark: ThemeColors, light: ThemeColors }` with exactly the UI spec §4 names and hex values (`bg, surface, raised, ink, inkMuted, line, outline, signal, onSignal, speaker: [6]`); `spacing` (4/8 grid), `radius` (`card: 10`, `round: 999`), `typeScale` (4 sizes).
  - `paperTheme(scheme: "light" | "dark"): MD3Theme` built from the tokens; `fontConfig` mapping each variant to its own family (`IBMPlexSans_400Regular`, `IBMPlexSans_600SemiBold`, `IBMPlexMono_500Medium`) per platform spec §5.
  - `motion`: `{ press: { scale: 0.97 }, spring: {…}, durations: { fast: 150, base: 220, slow: 280 }, staggerMs: 30 }`.
  - `appInfo`: `{ name: string, version: string }` from `Constants.expoConfig.extra`.
  - `TabBar` (custom `tabBar` for expo-router `Tabs`): five slots in the order Meetings · Notes · ● · Chat · Settings; the centre slot renders `<RecordAction />`; tabs show icon + label, active state highlighted; ≥ 48 dp targets; accessibility labels. `RecordAction` is a placeholder 64 dp signal-coloured disc with `accessibilityLabel="Record"` and a no-op `onPress`; the mobile recording plan replaces its body.
  - Root `_layout.tsx`: loads fonts (splash until loaded), PaperProvider with the scheme-based theme (user preference wired by the chat-settings plan), `Stack` with `(tabs)`; Task 6 adds the QueryClientProvider.
  - `eas.json`: profile `preview` with `android.buildType: "apk"`, `distribution: "internal"`.

- [ ] **Step 1: Scaffold.** From the repo root: `npx create-expo-app@latest mobile` with the non-interactive flags shown by `--help` (template with expo-router and TypeScript, SDK 58, no git init). Confirm `expo` is `~58` in `mobile/package.json`. Add packages with `npx expo install react-native-paper @tanstack/react-query @react-native-async-storage/async-storage expo-font @expo-google-fonts/ibm-plex-sans @expo-google-fonts/ibm-plex-mono expo-constants react-native-safe-area-context` and dev tools `npm i -D jest-expo @testing-library/react-native openapi-typescript eslint prettier eslint-config-expo`. Remove the template's example screens. `tsconfig` `strict: true`.
- [ ] **Step 2: `app.config.ts`** reads `../config/app.json` and sets `name`, `slug`, `version` and `extra: { appName, appVersion }`; Android package id derived from the slug. No other file mentions the name.
- [ ] **Step 3: Write the failing tests.**
  - `tokens.test.ts`: every UI spec §4 hex value is present under its name in both themes (table-driven); `speaker` has 6 entries per theme.
  - `TabBar.test.tsx` (render with a mocked tab state): five slots in order, the centre one has accessibility label "Record", the four tabs have labels "Meetings", "Notes", "Chat", "Settings", and the active tab is marked selected (`accessibilityState.selected`).
- [ ] **Step 4: Run** `cd mobile && npx jest` → FAIL.
- [ ] **Step 5: Implement** tokens, theme, fonts, motion, `TabBar`, `RecordAction`, layouts and four placeholder screens (each shows its title using the Paper theme).
- [ ] **Step 6: Run** `npx jest`, `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` → all clean. `npx expo start` opens in Expo Go on a phone and shows the tab bar in both themes (then stop it).
- [ ] **Step 7: Commit** `feat(mobile): add Expo scaffold, theme and tab bar`.
- [ ] **Step 8 (manual, lead: EAS account): throwaway APK.** `npx eas-cli init`: because `app.config.ts` is dynamic, EAS cannot write into it; copy the printed project id into `extra.eas.projectId` and set `owner` in `app.config.ts`, commit (`chore(mobile): add EAS project id`). Then `npx eas-cli build -p android --profile preview`, install the APK on an Android phone, check it opens and shows the tab bar; record the build time and any problem in the plan issue. An agent implementer closes the code part (Steps 1–7) and leaves this step to the lead.

### Task 6: Mobile API client, generated types, server URL

**Files:**
- Create: `mobile/src/api/schema.d.ts` (generated), `mobile/src/api/client.ts`, `mobile/src/api/errors.ts`, `mobile/src/api/queryClient.ts`, `mobile/src/settings/serverUrl.ts`, `mobile/package.json` script `gen:api`
- Test: `mobile/src/api/client.test.ts`, `mobile/src/settings/serverUrl.test.ts`

**Interfaces:**
- Consumes: `backend/openapi.json` (Task 4).
- Produces:
  - `npm run gen:api` → `openapi-typescript ../backend/openapi.json -o src/api/schema.d.ts`; the file is committed.
  - `type Schemas = components["schemas"]` re-exported for feature code (`Schemas["RecordingOut"]`, …).
  - `class ApiError extends Error { status: number; code: ErrorCode | "network_error" | "timeout"; message: string }` where `ErrorCode` is the generated enum union.
  - `apiFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>`: prefixes the stored server URL + `/api/v1`, 10 s default timeout (AbortController), parses the error contract into `ApiError`, maps fetch failures to `code: "network_error"` and aborts to `"timeout"`.
  - `queryClient`: TanStack Query client; queries `retry: 2` with backoff; mutations `retry: 0`.
  - `normalizeServerUrl(input: string): { url: string; https: boolean }` (trim, drop trailing `/`, keep scheme); `getServerUrl(): Promise<string | null>`, `setServerUrl(url: string): Promise<void>` (AsyncStorage key `server_url`), `useServerUrl()` hook.

- [ ] **Step 1: Generate types** with `npm run gen:api`; add `src/api/schema.d.ts` to `.prettierignore` and to the ESLint ignores (generated code).
- [ ] **Step 2: Write the failing tests** (mock `fetch` and AsyncStorage):
  - `apiFetch` returns parsed JSON on 200; on 501 with the contract body throws `ApiError` with `code "not_implemented"` and the server message; on a body that is not the contract shape throws `code "internal_error"`; on a rejected fetch throws `"network_error"`; on timeout throws `"timeout"`.
  - `normalizeServerUrl("  https://laptop.tail.ts.net/ ")` → `{ url: "https://laptop.tail.ts.net", https: true }`; `"http://x"` → `https: false`.
  - `setServerUrl` then `getServerUrl` round-trips the normalised value.
- [ ] **Step 3: Run** `npx jest src/api src/settings` → FAIL.
- [ ] **Step 4: Implement** the modules; wire `QueryClientProvider` in `app/_layout.tsx`.
- [ ] **Step 5: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 6: Commit** `feat(mobile): add typed API client and server URL setting`.

### Task 7: CI, AGENTS.md commands, setup doc

**Files:**
- Create: `.github/workflows/backend.yml`, `.github/workflows/mobile.yml`, `docs/setup.md`
- Modify: `AGENTS.md` (replace the "Status" section with "Backend commands" and "Mobile commands")

**Interfaces:**
- Consumes: the commands of Tasks 1–6.
- Produces: CI on pushes to `plan/**` and on PRs to `main`:
  - backend (ubuntu, uv, Python 3.12, working dir `backend`): `uv sync --locked`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `uv run pytest`, `uv run python -m app.cli export-openapi --check`;
  - mobile (Node LTS, working dir `mobile`): `npm ci`, `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `npx jest --ci`, `npm run gen:api` then `git diff --exit-code src/api/schema.d.ts`.

- [ ] **Step 1: Write both workflows**; push the branch and confirm both jobs pass on GitHub.
- [ ] **Step 2: Update `AGENTS.md`**: remove "Status"; add "Backend commands" (install `cd backend && uv sync`; run `uv run python -m app.cli serve`; test, lint, format, types and openapi commands as in CI; the speech extra arrives with the processing plan) and "Mobile commands" (`npm ci`, `npx expo start`, `npm run gen:api`, test/lint/format/types as in CI, EAS `npx eas-cli build -p android --profile preview`).
- [ ] **Step 3: Write `docs/setup.md`** (the parts needed now): Tailscale on laptop and phone (same tailnet, MagicDNS and HTTPS certificates enabled in the admin console), `tailscale serve --bg 8000` (never `tailscale funnel`), the resulting `https://<machine>.<tailnet>.ts.net` URL entered in the app; `backend/.env` from `.env.example`, each teammate with their own keys, the demo laptop's keys used for nothing else; checking `sqlite_vec` loads (`uv run python -c "import sqlite3, sqlite_vec; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); print('ok')"`). The processing plan adds the speech install, Hugging Face token and model download sections.
- [ ] **Step 4 (manual, lead): phone check over Tailscale.** Laptop runs `serve` + `tailscale serve`; the phone (Expo Go) can reach `https://<machine>.<tailnet>.ts.net/api/v1/health` (browser is enough). Record the result in the plan issue.
- [ ] **Step 5: Commit** `chore: add CI, agent commands and setup doc`.

## Self-review notes
- Spec coverage: schema (data-API §1) Task 2; LLM schemas Task 3; stored analysis shape (§2), routes (§4) and errors (§5) Task 4; config and registry (platform §1) Task 1; navigation and tokens (UI §1, §4) Task 5; client error mapping (UI §6, partial) Task 6; CI and testing frame (platform §4) Task 7; Tailscale setup (platform §2–§3) Task 7. Everything else belongs to plans 2–5.
- Dependencies: Task 2 needs 1; Task 3 needs 1–2; Task 4 needs 1–3; Task 5 needs nothing; Task 6 needs 4 and 5; Task 7 needs 4 and 6. Manual lead steps: Task 5 Step 8 (APK), Task 7 Step 4 (phone over Tailscale). Backend (1→2→3→4) and mobile (5) run in parallel.
