# Stage 1 design: configuration, installs, security, testing, platform quirks

Part of the stage 1 spec (overview: `2026-10-16-stage-1-design.md`). Approved in sections 4–6 of the brainstorming.

## 1. Configuration and initial model picks
- `config/app.json`: app name and branding (roadmap). Read by the backend and by `mobile/app.config.ts`.
- `config/models.yaml` (the registry, chat file §1). Initial entries:
  - `llm` (Chat): Groq `openai/gpt-oss-20b` (light, tool use), then a Gemini Flash model.
  - `llm_analysis` (processing): a Gemini Flash model, then Groq `openai/gpt-oss-120b`.
  - `embedder`: fastembed `BAAI/bge-small-en-v1.5`, local, CPU.
  - `asr`: faster-whisper `distil-large-v3`, local, `cuda` + `int8_float16` (env override `ASR_DEVICE=cpu` switches to `cpu` + `int8`).
  - `diarizer`: pyannote `speaker-diarization-community-1`, local, `cuda` (env override `DIARIZER_DEVICE=cpu`).
  - The exact Gemini Flash id and both providers' current ids are confirmed in the first backend task from each provider's `GET /models`; the failover order stays editable in the file.
- Backend settings (env-overridable, pydantic-settings): data dir (default `platformdirs.user_data_dir` named from `config/app.json`), model cache dir, bind host (default `127.0.0.1`), port, speech backend (`real` | `fake`), upload size limit (200 MB), chunk size / boundary minimum / overlap, retrieval `k` and `max_distance`, Chat deadline (75 s), speech step timeout.
- Secrets only in env vars: `backend/.env` (git-ignored), names listed in `backend/.env.example`: `GROQ_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN`.

## 2. Installs and running (one command each)
| Who | Command | What it does |
|---|---|---|
| Laptop (Windows, GPU), install | `uv run --extra speech python -m app.cli setup` | syncs dependencies including torch, downloads every model into the model cache dir, checks `.env` and prints anything missing |
| Laptop, run | `uv run --extra speech python -m app.cli serve` | starts the API and the worker on `127.0.0.1` with `HF_HUB_OFFLINE=1`; then `tailscale serve` per the setup doc |
| Teammates without a GPU | same commands with `ASR_DEVICE=cpu` and `DIARIZER_DEVICE=cpu` in their `backend/.env` | the real pipeline, slower; `models.yaml` stays on `cuda` |
| Dev / CI | `uv sync`, `uv run pytest` | no speech extra, no torch; speech backend `fake` |
| Mobile | `npm ci`, `npx expo start` | Expo Go; the APK comes from EAS profile `preview` |

- The speech extra pins torch / torchaudio to the PyTorch cu128 index on Windows and Linux (uv source markers) and to PyPI on macOS (no cu128 macOS builds).
- PyAV (`av`) is a base dependency (cp312 Windows wheel with FFmpeg bundled, verified), so decoding needs no system ffmpeg and works in CI.
- On the laptop, always pass `--extra speech`; a plain `uv sync` removes the speech packages.
- Setup doc (`docs/setup.md`): Tailscale (MagicDNS and HTTPS certificates enabled, `tailscale serve` never `tailscale funnel`), Hugging Face token with the pyannote model terms accepted, `.env` keys (every teammate uses their own keys; the demo laptop's keys are used for nothing else), disk space for the model cache, checking that `sqlite_vec.load()` works under uv's Python (LanceDB is the agreed fallback), building the APK with EAS.

## 3. Security
- Boundary: the private tailnet. The server binds `127.0.0.1` and is reached only through `tailscale serve` HTTPS; never `tailscale funnel`. No app-level auth (roadmap).
- Secrets: env only; settings hold keys as `SecretStr`; keys never appear in logs, errors, URLs, reprs or test fixtures; a `base_url` with credentials is refused at load (roadmap).
- Prompt injection: transcripts and tool output wrapped and delimiter-escaped; tools take labels, never IDs; scope and tag filter enforced inside the tools from server context.
- Uploads: size and type limits; files stored under generated ids, never user-supplied names; audio served only by recording id.
- Errors: no paths, keys or stack traces in responses.
- Free LLM tiers may train on inputs: demo recordings only (AGENTS.md). Recordings go to Gemini's free tier first for analysis.

## 4. Testing
Backend (pytest; no network, no torch, fake speech, fake chat models):
- Unit: citation check and source registry; speaker-token rewrite and renderer; chunker; tag normalisation and reuse; analysis post-processing (S-number mapping, owner mapping, dropped items logged); `llm_analysis` failover walk and map-reduce planning; final-answer middleware; retry predicate; upload idempotency; claim and conditional delete; error-shape handlers; delimiter escaping.
- Integration: upload → processing → `ready` with fake speech and a scripted fake LLM; Chat run with a fake chat model that calls tools (citations resolved, "Not in your recordings", fixed reply types); resume at the interrupted step after restart; retry from the failed step; Chat deadline.
- Contract: CI regenerates `backend/openapi.json` and fails if it differs.
- Manual (not CI): the Groq + Gemini smoke test; relevance cut-off calibration on the demo recordings.

Mobile (jest + React Native Testing Library, logic first): citation and deep-link mapping; upload queue (pending files survive restart, retry, idempotency id); polling state machines (processing, Chat run); error-code messages; speaker turn grouping. CI checks that types generated from `openapi.json` match the committed ones.

CI (GitHub Actions on `plan/*` branches and PRs): backend `ruff check`, `ruff format --check`, `pyright` (strict), `pytest`, openapi check; mobile `tsc --noEmit`, ESLint, Prettier check, jest, generated-types check.

Demo checklist (manual, before Tuesday): the roadmap walkthrough on the real phone over Tailscale, in the EAS APK and in Expo Go; a silent recording; an upload with Wi-Fi turned off and retried; a Chat question with nothing relevant.

## 5. Platform quirks
- Android fonts: a custom font's weight is not changed by `fontWeight`; Paper's `configureFonts` maps each variant to its own family name (`IBMPlexSans_600SemiBold`, …).
- expo-audio records into the cache directory, which Android may clear: move the file to `documentDirectory` (expo-file-system) on Stop.
- Background recording only in the EAS build: config plugin `["expo-audio", { "enableBackgroundRecording": true }]` (foreground service with `FOREGROUND_SERVICE_MICROPHONE`) and `allowsBackgroundRecording: true` set only when `Constants.executionEnvironment !== 'storeClient'`. In Expo Go, leaving the app pauses the recorder (`pauseForSystem`, verified in expo-audio 58.0.9) and expo-audio resumes it by itself on return; the app pauses it again on return and shows Resume / Stop, so recording never continues without the user choosing to.
- Android metering: `metering` = `20·log10(maxAmplitude/32767)` dBFS, −160 on silence (verified); `maxAmplitude` is the peak since the last read.
- Upload progress: React Native's `fetch` has none; XMLHttpRequest `upload.onprogress` works (verified in React Native 0.88's Android networking).
- EAS `preview` profile sets `android.buildType: "apk"` (an AAB cannot be sideloaded). EAS free builds can queue for 90+ minutes: build by Monday morning.
- LangChain: always `ToolStrategy`; `ModelRetryMiddleware(on_failure="error")`; middleware list order = outermost first.
- fastembed 0.9 does not add BGE's query instruction; the embedder wrapper does.
- Windows CUDA: `os.add_dll_directory(<venv>/Lib/site-packages/torch/lib)` at the top of the ASR child module, Windows only; torch from the cu128 index (PyPI's Windows torch is CPU-only).
- Speech children start with `subprocess.run([sys.executable, "-m", …])`, not `multiprocessing` spawn (re-imports the parent's main module on Windows).
- `sqlite_vec.load()` must work under uv's Python on Windows; otherwise LanceDB.
- No custom native code and no Skia, so the app runs in Expo Go.
