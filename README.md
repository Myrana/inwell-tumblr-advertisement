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

To allow the runner to click the detected submit button after filling the form:

```powershell
npm.cmd run tumblr:runner -- --plan .\tumblr-runner-plan.json --submit
```

The runner stops for manual action when Tumblr shows login, captcha, changed form
markup, missing upload controls, target-blog terms, or any other state that needs
human review. It does not store Tumblr credentials and does not bypass Tumblr
protections.

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
