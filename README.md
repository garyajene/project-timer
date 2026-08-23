# Project Timer

A dark, minimal personal productivity web app with private accounts, timer logic, sounds, and SQLite persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Persistence

Projects, schedules, Notes, Auto-Start, Quick Task, and running or paused timer state are loaded from and saved to the server through `/api/state`. The server stores the complete workspace transactionally in `DATA_DIR/project-timer.sqlite` (`.data` by default); browser storage is only a fallback cache for temporary server outages. Running timers use a saved ending timestamp, so restoring a timer does not infer elapsed work from its Calendar start time. In production, set `DATA_DIR` to a durable mounted volume (for example `/data`). Every account has a private workspace in the same SQLite file. The application does not use `DATABASE_URL` or require a migration command.

## Railway account activation

Do these steps in order. Do not remove or change the existing volume mount or `DATA_DIR`.

1. Set `OWNER_EMAIL` to the owner's normalized email address and set `REGISTRATION_ENABLED=true`.
2. Deploy this release. Authentication is always enabled and the login screen appears automatically; `AUTH_ENABLED` is no longer used.
3. Immediately register **the exact `OWNER_EMAIL` address** with a password of at least 12 characters. This transaction creates the owner and copies and verifies the existing `app_state` JSON in the owner's private row.
4. Confirm the owner's Projects, Calendar, Notes, timer/Quick Task, Zen Break, and Auto-Start data.
5. Set `REGISTRATION_ENABLED=false` and redeploy. Registration is now closed while login and existing sessions continue working.

To add another user later, briefly enable registration during a controlled window, register that address, and disable it again. New non-owner users receive an empty workspace. The unique email and workspace constraints refuse duplicate owner claims rather than overwriting a workspace.

Session cookies are opaque, server-managed, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Passwords use Node's scrypt. Authenticated state writes include a revision and stale writes receive HTTP 409.
