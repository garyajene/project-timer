# Project Timer

A dark, minimal personal productivity web app with private accounts, timer logic, sounds, and SQLite persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Persistence

Projects, schedules, Notes, Auto-Start, Quick Task, and running or paused timer state are loaded from and saved to the server through `/api/state`. The server stores the complete workspace transactionally in `DATA_DIR/project-timer.sqlite` (`.data` by default); browser storage is only a fallback cache for temporary server outages. Running timers use a saved ending timestamp, so restoring a timer does not infer elapsed work from its Calendar start time. In production, set `DATA_DIR` to a durable mounted volume (for example `/data`). With account mode enabled, every account has a private workspace in the same SQLite file. With account mode disabled, the legacy `app_state` workspace remains shared by all browsers connected to the deployment. The application does not use `DATABASE_URL` or require a migration command.

## Safe Railway account activation

Do these steps in order. Do not remove or change the existing volume mount or `DATA_DIR`.

1. Deploy this release with `AUTH_ENABLED=false`. Leave `REGISTRATION_ENABLED=false`. Confirm the application opens and the legacy workspace is intact.
2. Set `OWNER_EMAIL` to the owner's normalized email address. Keep `AUTH_ENABLED=false` and redeploy. This does not copy or modify any workspace.
3. Set `AUTH_ENABLED=true` and `REGISTRATION_ENABLED=true`, then redeploy. The legacy `app_state` remains untouched and the login screen appears.
4. Immediately register **the exact `OWNER_EMAIL` address** with a password of at least 12 characters. This transaction creates the owner and copies and verifies the existing `app_state` JSON in the owner's private row.
5. Confirm the owner's Projects, Calendar, Notes, timer/Quick Task, Zen Break, and Auto-Start data.
6. Set `REGISTRATION_ENABLED=false` and redeploy. Leave `AUTH_ENABLED=true` and `OWNER_EMAIL` set. Registration is now closed while login and existing sessions continue working.

To add another user later, briefly enable registration during a controlled window, register that address, and disable it again. New non-owner users receive an empty workspace. The unique email and workspace constraints refuse duplicate owner claims rather than overwriting a workspace. To roll back access safely, set `AUTH_ENABLED=false`; the unchanged `app_state` immediately restores the original single-user behavior.

Session cookies are opaque, server-managed, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Passwords use Node's scrypt. Authenticated state writes include a revision and stale writes receive HTTP 409.
