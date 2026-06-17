# Inwell Tumblr Advertisement Assistant

Inwell Tumblr Advertisement Assistant is a React and TypeScript MVP for creating, saving, reusing, validating, and preparing Tumblr forum advertisement posts.

## Local Development

```powershell
npm.cmd install
npm.cmd run api
npm.cmd run dev -- --port 8020
```

The frontend runs on `http://127.0.0.1:8020`.
The Python SQLite API runs on `http://127.0.0.1:8021`.

The frontend uses the API when it is running and falls back to browser-local storage when it is not. SQLite runtime files are ignored by Git.
