# Development setup

This guide covers setting up the backend and the mobile app. Every backend route
is implemented. With `SPEECH_BACKEND=real` (the default) speech runs in child
processes and needs the speech extra and downloaded models (see
[Real speech and models](#real-speech-and-models)); `SPEECH_BACKEND=fake` binds
canned speech for development. Analysis always uses the real LLM summarizer, so a
recording reaches `ready` only when `GROQ_API_KEY` or `GEMINI_API_KEY` is set in
`backend/.env` (a recording in which no speech is found ends `ready` and Untitled
without analysis; see
[Backend dependencies and environment](#backend-dependencies-and-environment)).

## Prerequisites

- Git and a checkout of the plan branch assigned to your task; follow
  [AGENTS.md](../AGENTS.md) for the team workflow.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) and Python 3.12.
  `uv python install 3.12` installs the interpreter if needed.
- [Node.js LTS](https://nodejs.org/en/download) with npm, matching CI's `lts/*`.
- An Android phone with an Expo Go version compatible with this project's Expo
  SDK 58, plus an Expo account. Android Studio is not required.
- [Tailscale](https://tailscale.com/download) on the laptop and phone, with both
  devices signed into the same tailnet. A tailnet administrator must enable the
  DNS features described below.

Run commands from the directory named in each section. They work in PowerShell
unless a different shell is explicitly named. Start from the repository root.

## Backend dependencies and environment

```powershell
cd backend
uv sync --locked
```

Create `backend/.env` from `backend/.env.example` once. From `backend/`, this
PowerShell command refuses to overwrite an existing file:

```powershell
if (!(Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

Edit `.env` locally. Each teammate must use their own provider accounts and keys;
the demo laptop's keys must be dedicated to this project and used for nothing
else. Never commit `.env`, paste keys into URLs, or put keys in configuration
files or logs. The file is git-ignored.

| Variable | Current use |
| --- | --- |
| `GROQ_API_KEY` | Key for the configured Groq provider. Either this key or `GEMINI_API_KEY` is enough for Chat and for analysis; with both, each role fails over to the other provider. |
| `GEMINI_API_KEY` | Key for the configured Gemini provider. Either this key or `GROQ_API_KEY` is enough for Chat and for analysis; with both, each role fails over to the other provider. |
| `HF_TOKEN` | Hugging Face token for the real diarizer and its model download; see [Hugging Face token](#hugging-face-token). |
| `SPEECH_BACKEND` | Optional `real` (default) or `fake`. `fake` needs no speech extra, models or token; set it on machines that only develop the UI or API. |
| `ASR_DEVICE`, `DIARIZER_DEVICE` | Optional device overrides; set both to `cpu` on a machine without a CUDA GPU (slower). `config/models.yaml` stays on `cuda`. |

In the health response, an LLM role is `ready` when the key of at least one of
its models is set. With none, the reason names every missing key in the role's
order in `config/models.yaml`, such as `Missing GROQ_API_KEY and GEMINI_API_KEY`.
`ready` only checks that a key is present; it does not validate credentials,
contact providers, or verify model availability. Existing
process environment variables take precedence over `.env`; restart the backend
after changing configuration.

The app name and version come from `config/app.json`; provider and model choices
come from `config/models.yaml`. Keep secrets out of both. Real speech packages,
the Hugging Face token and model downloads are covered in
[Real speech and models](#real-speech-and-models). Hosted-model demos must use demo recordings only, since free
tiers may use inputs for training.

The default database is `app.db` in the per-user data directory selected by
`platformdirs` from the configured app name. The model cache defaults to its
`models` subdirectory. Optional `DATA_DIR` and `MODEL_CACHE_DIR` environment
overrides must point outside the repository. Keep runtime data out of Git and
never use repository cleanup commands against the data or model-cache directory.

Check that Python can load the SQLite vector extension, from `backend/`:

```powershell
uv run python -c "import sqlite3, sqlite_vec; c=sqlite3.connect(':memory:'); c.enable_load_extension(True); sqlite_vec.load(c); print('ok')"
```

Expected output is `ok`. If extension loading fails, check that you are using the
uv-managed Python 3.12 environment and have installed the locked dependencies;
resolve the extension-loading error before proceeding.

Start the backend in this terminal:

```powershell
uv run python -m app.cli serve
```

Startup creates the data directory and applies database migrations. The defaults
are `BIND_HOST=127.0.0.1` and `PORT=8000`; keep these for the Tailscale setup below.
In a second terminal, check:

```powershell
curl.exe http://127.0.0.1:8000/api/v1/health
```

Expect HTTP 200 and JSON containing `app_name`, `version`, `speech_backend`
(`"real"` by default, `"fake"` with `SPEECH_BACKEND=fake`) and `roles`; each role
is `ready` or the reason it is not, such as `Model not downloaded`.
`"Speech extra not installed"` means `uv sync --extra speech` is needed.

Analysis tries the `llm_analysis` models in order (currently Gemini, then Groq;
the order is set in `config/models.yaml`); a model whose key is missing is
skipped, so one of `GROQ_API_KEY` or `GEMINI_API_KEY` is enough. With neither,
an upload that reaches analysis ends `failed` with `failed_step` `analyzing` and
error code `analysis_failed`. This holds with `SPEECH_BACKEND=fake` too, since
only speech is canned.

## Real speech and models

The real ASR (faster-whisper) and diarizer (pyannote) need torch and run only on
machines that install the backend's `speech` extra. Each recording's ASR and
diarization run in their own child process, so the GPU never holds both models.
The models used are the `asr`, `diarizer` and `embedder` roles in
`config/models.yaml`.

### Speech extra (laptop)

From `backend/`, install everything including torch (the CUDA 12.8 build on
Windows and Linux, the PyPI build on macOS):

```powershell
uv sync --extra speech
```

Always pass `--extra speech` on this machine: a plain `uv sync` removes the speech
packages again. Run the backend with
`uv run --extra speech python -m app.cli serve`. Without a CUDA GPU, set
`ASR_DEVICE=cpu` and `DIARIZER_DEVICE=cpu` in `backend/.env`. Dev and CI machines
skip the extra and set `SPEECH_BACKEND=fake`.

### Hugging Face token

The diarizer model (`roles.diarizer` in `config/models.yaml`) is gated on
Hugging Face:

1. Sign in at [huggingface.co](https://huggingface.co), open the page of that
   model (`https://huggingface.co/<model id>`) and accept its user conditions.
2. Create a read token under
   [Settings > Access Tokens](https://huggingface.co/settings/tokens).
3. Put it in `backend/.env` as `HF_TOKEN=...`. Never commit it or paste it
   anywhere else.

Without the token, `/health` reports the diarizer as `Missing HF_TOKEN` and setup
skips the diarizer download.

### Downloading models

From `backend/`, run once (and again after a model changes in
`config/models.yaml`):

```powershell
uv run --extra speech python -m app.cli setup
```

Setup creates the data and model cache directories, downloads the embedder and,
when the speech extra is installed, the ASR and diarizer models into the model
cache directory. It then prints each role's readiness and the names of missing
environment variables (never their values). Without the speech extra it
downloads only the embedder and says so. `serve` sets `HF_HUB_OFFLINE=1`, so
nothing downloads while it runs: a model setup did not download makes its role
report `Model not downloaded` in `/health` and its processing step fail at once.

Keep several GB free: the model cache (`MODEL_CACHE_DIR`, by default the `models`
folder in the data directory) holds a few GB of models, and torch with CUDA adds
several GB more to `backend/.venv`.

## Provider smoke test and relevance calibration

Once provider keys (`GROQ_API_KEY`, `GEMINI_API_KEY`) are set in `backend/.env`,
you can run the LLM smoke tests from `backend/`:

```powershell
uv run python -m app.cli smoke-llm
```

This verifies that:
1. Configured models exist on each provider (via `GET /models` for OpenAI/Groq, or `genai_client.models.list()` for Google GenAI).
2. For every distinct configured model across all roles:
   - The orchestrator can invoke tool calls.
   - The forced final turn succeeds with tool history and `tool_choice="required"`.
   - The summarizer produces valid analysis.
3. Cross-provider failover: for every ordered pair `(A, B)` of distinct configured models whose providers differ, an earlier tool call from model A's orchestrator turn can be passed in history to model B and returns without error.

To calibrate the retrieval distance cutoff (`retrieval_max_distance` in `backend/app/config/settings.py`)
against seeded demo recordings:

```powershell
uv run python -m app.cli seed-demo
uv run python -m app.cli calibrate-retrieval --questions ../docs/calibration-questions.example.yaml
```

Run `calibrate-retrieval` only against demo data seeded with the real embedder.
Earlier versions embedded the demo chunks with a fake embedder; those vectors have
the same size as real ones, so nothing errors, but chat search silently finds none of
the seeded recordings. `seed-demo` refuses a non-empty database and there is no
re-index command, so replace such a data directory: point `DATA_DIR` at a fresh
folder outside the repository, then run `seed-demo` again before
`calibrate-retrieval`. The model cache follows `DATA_DIR` unless `MODEL_CACHE_DIR`
is set, so the first `seed-demo` on a fresh folder downloads the embedder.

The script reports the best cosine distance for expected and unrelated queries, detects any
overlap between expected hits and unrelated hits, and suggests an optimal `retrieval_max_distance` threshold.

## Private HTTPS from the phone

1. Connect both devices to Tailscale and confirm they appear in the same tailnet.
2. In the Tailscale admin console's **DNS** page, enable **MagicDNS** and
   **HTTPS Certificates**. See the official
   [HTTPS setup instructions](https://tailscale.com/docs/how-to/set-up-https-certificates).
3. Keep the backend running on laptop loopback port 8000. In another laptop
   terminal run:

   ```powershell
   tailscale serve --bg 8000
   tailscale serve status
   ```

4. Copy the HTTPS URL printed by Serve, shaped like
   `https://<machine>.<tailnet>.ts.net`. Use the actual printed name. Serve handles
   the TLS certificate and proxies to the local backend. The phone's tailnet
   permissions must allow access to the laptop on HTTPS port 443.

Use **Serve only**; never run `tailscale funnel` for this backend. Serve is
private to the tailnet; Funnel exposes a service to the public internet. See the
official [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

The app's server URL is the HTTPS base URL, without `/api/v1` or `/health`; its
client adds `/api/v1` itself. Enter it in the app's Settings screen under
**Server**, tap **Test connection** (it shows `Connected` or what is wrong), then
**Save**. Opening the health URL in the phone's browser first, as in
[Manual phone check (lead)](#manual-phone-check-lead), is an optional check that
separates network problems from app problems.

Serve's `--bg` configuration persists after the terminal closes. On a laptop
where this is the dedicated HTTPS Serve endpoint, disable it after the check:

```powershell
tailscale serve --bg --https=443 off
tailscale serve status
```

Stop the backend with Ctrl+C in its terminal.

## Mobile dependencies and Expo Go

In a new terminal, from the repository root:

```powershell
cd mobile
npm ci
npx expo login
npx expo start
```

Sign in to the same Expo account in Expo Go on Android. Expo Go SDK 57 and later
require authentication in both the CLI and Expo Go; see the official
[Expo Go login notice](https://expo.dev/changelog/expo-go-57-login).
Keep laptop and phone on the same Wi-Fi network for the development bundle,
then scan the terminal QR code using Expo Go. See
[Expo's development guide](https://docs.expo.dev/get-started/start-developing/).
Tailscale Serve above exposes only the backend, not Expo's development server.

Check that Meetings, Notes, Record, Chat and Settings appear in that order and
that the app opens under both light and dark device themes. Record is a no-op.
Stop Expo with Ctrl+C when finished.

`npm ci` installs the API generator workspace along with the app. Run API type
generation through `npm run gen:api`; the workspace has its own TypeScript 5
dependency while the Expo app uses TypeScript 6.

An APK is a separate manual lead check. The dynamic `app.config.ts` now links the
shared EAS project through `owner` and `extra.eas.projectId`, preserving the
app-name/version extras. Sign in to an Expo account with access to that project
and verify the link with `npx eas-cli project:info` before building.
Then `npx eas-cli build -p android --profile preview` uses the committed internal
APK profile. Install the result on Android and record startup, build time and any
problems in the plan issue. Expo Go or CI passing does not verify APK installation.

## Manual phone check (lead)

With the backend running and Serve enabled, connect the Android phone to
Tailscale and open the actual URL
`https://<machine>.<tailnet>.ts.net/api/v1/health` in its browser. Confirm HTTP 200
with the expected health JSON and the `speech_backend` you configured. Record the date,
device, URL host, result and any problem in the plan issue, without credentials.
This proves phone-to-backend connectivity; app configuration and feature behavior
remain separate checks. This manual result is not established by automated CI.

If local health works but phone health fails, check both devices' Tailscale
connection, the copied hostname, tailnet access rules, DNS/HTTPS settings and
`tailscale serve status`. If the app bundle fails to load, check Expo login,
SDK compatibility and Wi-Fi reachability separately. After checking, stop both
development servers and disable the dedicated Serve endpoint as described above.

For the complete local test, lint, type and API-generation commands, see
[AGENTS.md](../AGENTS.md).
