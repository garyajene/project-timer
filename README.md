# Project Timer

A dark, minimal personal productivity web app for a single user, with timer logic, sounds, and shared server-side persistence.

## Scripts

- `npm run dev` - start a local static development server.
- `npm run build` - create a production build.
- `npm run preview` - preview the production build locally.
- `npm test` - run the persistence and API test suite.

## Persistence

Projects, schedules, Notes, Auto-Start, Quick Task, and running or paused timer state are loaded from and saved to the server through `/api/state`. The server stores the complete workspace transactionally in the SQLite table `app_state` in `DATA_DIR/project-timer.sqlite` (`.data` by default); browser storage is only a fallback cache for temporary server outages. Running timers use a saved ending timestamp, so restoring a timer does not infer elapsed work from its Calendar start time. In production, set `DATA_DIR` to a durable mounted volume (for example `/data`). This app remains a single-user workspace, so all browsers connected to the deployment intentionally share the same state.
Railway redeploy
