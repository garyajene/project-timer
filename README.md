# Project Timer

A dark, minimal personal productivity web app for a single user, with timer logic, sounds, and shared server-side persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Accounts and persistence

Project Timer stores accounts, opaque server sessions, and one revision-protected JSONB workspace per user in PostgreSQL. Set `DATABASE_URL` before starting the server. State APIs require an authenticated session; browser storage is not used for workspace or session data.

Public registration is disabled by default. Set `ALLOW_REGISTRATION=true` only after the owner migration is verified. Passwords use Node's memory-hard scrypt implementation and session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

### Copy the legacy owner workspace

The migration command copies rather than moves the legacy SQLite state. It first creates a timestamped backup beside the SQLite database, imports the normalized state for the explicitly configured owner email, verifies a SHA-256 checksum, and leaves both the source and backup untouched.

```sh
DATABASE_URL=... \
OWNER_EMAIL=owner@example.com \
OWNER_PASSWORD='a long initial password' \
LEGACY_SQLITE_PATH=/data/project-timer.sqlite \
CONFIRM_OWNER_MIGRATION=copy-and-retain \
npm run migrate:owner
```

Do not enable public registration or remove the Railway SQLite volume until the owner has logged in, verified all projects and schedules, and PostgreSQL backup/restore has been confirmed.
