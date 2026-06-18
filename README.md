# Inwell Tumblr Advertisement Assistant

Inwell Tumblr Advertisement Assistant is a React and TypeScript MVP for creating, saving, reusing, validating, and preparing Tumblr forum advertisement posts.

## Local Development

```powershell
npm.cmd install
pip install -r requirements.txt
npm.cmd run api
npm.cmd run dev -- --port 8020
```

The frontend runs on `http://127.0.0.1:8020`.
The Python PostgreSQL API runs on `http://127.0.0.1:8021`.

The frontend uses the API when it is running and falls back to browser-local storage when it is not.

## Tumblr Queue Runner

The submission queue can export a local automation plan for a Playwright browser runner.

1. Queue one or more Tumblr targets in the app.
2. Click `Export automation plan`.
3. Save the downloaded `tumblr-runner-plan.json`.
4. Install the Playwright browser once:

```powershell
npm.cmd run tumblr:install-browsers
```

5. Run the local browser runner:

```powershell
npm.cmd run tumblr:runner -- --plan .\tumblr-runner-plan.json
```

The runner opens Tumblr submit pages in a persistent local browser profile at
`.tumblr-runner-profile`, so you can log into Tumblr once and reuse that session.
It fills supported text, photo, video URL, and tag fields when the public submit
form exposes normal controls. By default it pauses before final submission so
you can review the form.

When Tumblr drops or refuses the saved profile session, run login and queue
execution in one visible browser session:

```powershell
npm.cmd run tumblr:runner -- --plan .\tumblr-runner-plan.json --login-first
```

Log into Tumblr in the Playwright browser, wait for the dashboard to finish
loading, then press Enter in the runner terminal. The runner then opens the
queued submit page in the same browser context.

If an exported plan contains only an image filename, pass the folder that holds
the image so the runner can upload it:

```powershell
npm.cmd run tumblr:runner -- --plan .\tumblr-runner-plan.json --media-dir "C:\path\to\images"
```

To open the persistent Playwright browser profile and log into Tumblr manually:

```powershell
npm.cmd run tumblr:login
```

After logging in, inspect the queued target before running automation:

```powershell
npm.cmd run tumblr:inspect -- --plan .\tumblr-runner-plan.json
```

The inspect command reports whether the dashboard is logged in, whether the
direct Tumblr submit form is accessible, whether the public submit page exposes
form controls, and any blocker text Tumblr returns.

To allow the runner to click the detected submit button after filling the form:

```powershell
npm.cmd run tumblr:runner -- --plan .\tumblr-runner-plan.json --submit
```

The runner stops for manual action when Tumblr shows login, captcha, changed form
markup, missing upload controls, target-blog terms, or any other state that needs
human review. It does not store Tumblr credentials and does not bypass Tumblr
protections.

For a noninteractive smoke test that opens the queued target, reports the state,
and exits without waiting for review:

```powershell
npm.cmd run tumblr:runner -- --plan .\tumblr-runner-plan.json --headless --no-pause
```

## PostgreSQL Configuration

The API reads PostgreSQL settings from the standard environment variables:

```powershell
$env:PGHOST = "192.168.1.3"
$env:PGPORT = "5432"
$env:PGDATABASE = "inwell_tumblr_advertisement"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "<your password>"
npm.cmd run api
```

`DATABASE_URL` can be used instead of the individual `PG*` variables. Passwords and connection strings should stay in your local environment, not in source control.

## Railway Docker Deployment

The repository includes a production `Dockerfile` for Railway. It builds the
Vite frontend, runs the Python web service as a non-root `inwell` user, binds
to Railway's `PORT`, and serves the app and API from one web service.

Attach a Railway PostgreSQL database to the web service so Railway provides
`DATABASE_URL`. On startup, the web service connects through `DATABASE_URL` and
initializes the schema tables and `schema_migrations` record before accepting
traffic.

### Database schema versions

The API keeps a `schema_migrations` table in PostgreSQL. `backend/app.py` records the current baseline as `0003_runner_log_runs` during startup after the required tables and additive migrations are present.

For future database changes:

1. Add the migration logic to `initialize`.
2. Give the migration a new ordered version id, such as `0002_add_queue_notes`.
3. Record the version with `record_schema_version` only after the migration succeeds.
4. Add or update backend tests so the migration is idempotent.
