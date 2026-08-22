# Project Timer

A dark, minimal personal productivity web app with private accounts, timer logic, sounds, and SQLite persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Persistence

Projects, schedules, Notes, Auto-Start, Quick Task, and running or paused timer state are loaded from and saved to each account's private workspace through `/api/state`. The server stores all data in `DATA_DIR/project-timer.sqlite` (`.data` by default), and does not use `DATABASE_URL` or require a migration command. In production, keep `DATA_DIR` on a durable mounted volume (for example `/data`).

## Accounts and deployment

Accounts and public registration are available immediately after deployment. No Railway feature flags or owner-email variables are required.

On an upgraded deployment, the first account created receives a verified copy of the existing legacy `app_state` workspace. Later accounts receive empty, independent workspaces. The legacy `app_state` row remains untouched as a safety copy. Keep the existing Railway volume and `DATA_DIR` unchanged when deploying.

Session cookies are opaque, server-managed, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Passwords use Node's scrypt. Authenticated state writes include a revision and stale writes receive HTTP 409.
