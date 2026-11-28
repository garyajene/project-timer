# DoAbl

A dark, minimal personal productivity web app with private accounts, timer logic, sounds, and SQLite persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Persistence

Projects, schedules, Notes, Auto-Start, Quick Task, and running or paused timer state are loaded from and saved to the server through `/api/state`. The server stores the complete workspace transactionally in `DATA_DIR/project-timer.sqlite` (`.data` by default); browser storage is only a fallback cache for temporary server outages. Running timers use a saved ending timestamp, so restoring a timer does not infer elapsed work from its Calendar start time. In production, set `DATA_DIR` to a durable mounted volume (for example `/data`). Every account has a private workspace in the same SQLite file. The application does not use `DATABASE_URL` or require a migration command.

## Railway account activation and public registration

Do these steps in order. Do not remove or change the existing volume mount or `DATA_DIR`.

1. Set `OWNER_EMAIL` to the owner's normalized email address.
2. Deploy this release. Authentication and public registration are always enabled; `AUTH_ENABLED` and `REGISTRATION_ENABLED` are no longer used.
3. Register **the exact `OWNER_EMAIL` address** with a password of at least 12 characters. This transaction creates the owner and copies and verifies the existing `app_state` JSON in the owner's private row.
4. Confirm the owner's Projects, Calendar, Notes, timer/Quick Task, Zen Break, and Auto-Start data.

Anyone can register from the login screen at any time. New non-owner users receive an empty private workspace. The unique email and workspace constraints refuse duplicate owner claims rather than overwriting a workspace.

Session cookies are opaque, server-managed, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Passwords use Node's scrypt. Authenticated state writes include a revision and stale writes receive HTTP 409.

## Scheduler Executive

Executive uses the signed-in account and keeps chat history in the current browser tab until cleared, reloaded or logged out. Users can choose to include up to 30 project names and planning settings. Executive sends recent messages and any selected project context to Replicate. Microphone audio is decoded, checked for duration, and normalized in memory before transcription. Review and edit the transcript before sending it.

Approved suggestions add or update Projects. Subtasks are linked work items in Projects, and deadlines are planning notes. Generate Schedule continues to use the existing Scheduler rules. Suggestions expire after 30 minutes or when replaced by a newer reply.

Set `REPLICATE_API_TOKEN` on the server. No additional Railway variable is required. Local development requires the `sqlite3` and `ffmpeg` command-line tools, which Nixpacks installs on Railway. Use HTTPS for microphone access outside localhost.

| Optional environment variable | Default |
| --- | --- |
| `EXECUTIVE_CHAT_MODEL` | `openai/gpt-5.6-luna` |
| `EXECUTIVE_WHISPER_MODEL` | `vaibhavs10/incredibly-fast-whisper` using the latest version reported by Replicate |
| `EXECUTIVE_REQUESTS_PER_HOUR` | 15 |
| `EXECUTIVE_REQUESTS_PER_DAY` | 40 |
| `EXECUTIVE_CONTEXT_MESSAGES` | 12 |
| `EXECUTIVE_CONTEXT_CHARS` | 12,000 |
| `EXECUTIVE_OUTPUT_TOKENS` | 1,150 |
| `EXECUTIVE_RECORDING_SECONDS` | 60 |
| `EXECUTIVE_TIMEOUT_MS` | 50,000 |

The SQLite usage table records model, request and prediction IDs, status, and available usage metrics and cost estimates. It does not store messages, transcripts, or recordings.

[Replicate Luna API](https://replicate.com/openai/gpt-5.6-luna/api/schema) · [Replicate Whisper API](https://replicate.com/vaibhavs10/incredibly-fast-whisper/api/schema)
