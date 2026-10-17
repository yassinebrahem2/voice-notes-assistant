# Development setup

This guide covers the current foundation. The backend has a working health
endpoint and database migrations; feature routes return HTTP 501 with error code
`not_implemented`. Speech, embeddings and analysis use fakes even when
`SPEECH_BACKEND=real`. Mobile screens are placeholders and Record does nothing.
Successful setup does not yet mean recording, transcription or chat works.

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
| `GROQ_API_KEY` | Key for the configured Groq provider. |
| `GEMINI_API_KEY` | Key for the configured Gemini provider. |
| `HF_TOKEN` | Reserved for real diarization; may stay empty for the foundation. |
| `SPEECH_BACKEND` | Optional `real` or `fake`; both currently bind fakes. Leave the example override commented to use the default. |
| `ASR_DEVICE`, `DIARIZER_DEVICE` | Optional device overrides for later real speech; leave commented for this setup. |

Keys can remain empty for the foundation smoke checks. Missing LLM keys appear
in the health response as `Missing GROQ_API_KEY` or `Missing GEMINI_API_KEY`.
`ready` only checks presence of the first configured provider's key; it does not
validate credentials, contact providers, or verify model availability. Existing
process environment variables take precedence over `.env`; restart the backend
after changing configuration.

The app name and version come from `config/app.json`; provider and model choices
come from `config/models.yaml`. Keep secrets out of both. Real speech packages,
Hugging Face access/token instructions and model downloads arrive with the
processing plan. There is no `setup` CLI command or speech extra in this
foundation. Later hosted-model demos must use demo recordings only, since free
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

Expect HTTP 200 and JSON containing `app_name`, `version`,
`speech_backend: "fake"` and `roles`. A request to `/api/v1/recordings` currently
returns HTTP 501; that is expected foundation behavior.

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
client adds `/api/v1` itself. The current Settings screen is a placeholder: there
is no server URL input yet. URL storage and normalization helpers exist in
`mobile/src/settings/serverUrl.ts`, but entering the URL through the app awaits
the chat/settings plan. For this foundation, use the phone browser check below.

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

An APK is a separate manual lead check. The lead must first configure the EAS
project/account: the dynamic `app.config.ts` currently has no `owner` or
`extra.eas.projectId`. After `npx eas-cli init`, the lead must add those values
to the dynamic configuration, preserving the existing app-name/version extras.
Then `npx eas-cli build -p android --profile preview` uses the committed internal
APK profile. Install the result on Android and record startup, build time and any
problems in the plan issue. Expo Go or CI passing does not verify APK installation.

## Manual phone check (lead)

With the backend running and Serve enabled, connect the Android phone to
Tailscale and open the actual URL
`https://<machine>.<tailnet>.ts.net/api/v1/health` in its browser. Confirm HTTP 200
with the expected health JSON and `speech_backend: "fake"`. Record the date,
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
