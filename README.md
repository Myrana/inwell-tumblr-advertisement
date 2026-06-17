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

## PostgreSQL Configuration

The API reads PostgreSQL settings from the standard environment variables:

```powershell
$env:PGHOST = "19.168.1.3"
$env:PGPORT = "5432"
$env:PGDATABASE = "inwell_tumblr_advertisement"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "<your password>"
npm.cmd run api
```

`DATABASE_URL` can be used instead of the individual `PG*` variables. Passwords and connection strings should stay in your local environment, not in source control.
