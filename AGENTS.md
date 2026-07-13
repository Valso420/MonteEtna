# AGENTS.md

## Project

### Product

Monte Etna is a static landing page connecting a Spotify playlist with a closed WhatsApp group.

- `index.html` and local assets are served directly.
- There is no package install or build step.
- Preserve direct browser opening and static Vercel deployment.
- Keep the page focused on following the playlist, joining the group, or both.

## Source of truth

### Spotify data

- `scripts/sync-spotify-playlist.mjs` generates `data/spotify-playlist-tracks.json` and `data/spotify-playlist-summary.json`.
- `scripts/validate-spotify-data.mjs` validates both generated files.
- The landing reads the summary as static data and must not call Spotify or expose credentials in the browser.
- Do not hand-edit generated JSON or replace the historical CSV unless explicitly requested.
- Preserve nonzero track checks, exported/total consistency, required track fields, top/recent data, and valid JSON output.

## External systems

### Secrets and controlled operations

- Spotify credentials belong only in local environment variables or GitHub Actions secrets.
- Never write secrets to tracked files, captured logs, generated data, or responses.
- `scripts/get-spotify-refresh-token.mjs` intentionally prints a new refresh token once to an explicitly authorized local terminal. This one-shot output is the only exception; never persist or repeat it in files, captured logs, or responses.
- Keep secret fields in `.env.example` empty. Versioned non-secret defaults such as the playlist ID and loopback redirect URI are allowed.
- Do not run the token helper or Spotify sync, use a real Spotify account, dispatch or edit the workflow, commit or push generated data, or deploy unless the user explicitly requests that action.
- Do not change the scheduled workflow or its write permissions unless explicitly requested.

## Validation

### Site and data checks

- For page changes, open `index.html` and check layout, links, images, and static data fallback.
- For an affected `.mjs` file, run `node --check <path-to-script>` before data validation.
- For generated-data changes, run `node scripts/validate-spotify-data.mjs`.
- For workflow changes, inspect the YAML diff and verify the schedule, permissions, secret references, action versions, and committed paths; do not dispatch the workflow as validation.
- If an explicitly requested sync is run, verify that only the expected generated JSON files changed and inspect their diff before any commit, push, workflow action, or deployment.
