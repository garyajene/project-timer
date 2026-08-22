# Project Timer

A dark, minimal personal productivity web app with private accounts, timer logic, sounds, and server-side persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Persistence

Projects, schedules, Notes, Auto-Start, Quick Task, and timer state are stored as one revision-protected workspace per user in SQLite. The server keeps the original `app_state` row unchanged as a legacy rollback source. Authentication uses memory-hard scrypt password hashes and revocable, opaque session cookies; workspace APIs derive identity only from the authenticated session.

In production, set `DATA_DIR` to the durable mounted volume (for example `/data`). Public registration is disabled unless `ALLOW_REGISTRATION=true` is configured.

## Owner setup

Before deploying the account UI, stop writes and back up the Railway volume. Then run the explicit owner bootstrap against the durable `DATA_DIR`:

```sh
DATA_DIR=/data \
OWNER_EMAIL=owner@example.com \
OWNER_PASSWORD='a unique password of at least 12 characters' \
CONFIRM_OWNER_BOOTSTRAP=copy-and-retain \
npm run bootstrap:owner
```

The command creates another timestamped SQLite backup, creates or verifies the configured owner, copies the legacy workspace into only that account, verifies the copy, and does not delete `app_state`. Log in and verify the owner workspace before setting `ALLOW_REGISTRATION=true` for new empty accounts.
