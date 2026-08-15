# ReleasePilot

Local artist dashboard and backend for creating, reviewing, scheduling, uploading, publishing, and learning from music-led social content.

## What is included

- Browser dashboard: `outputs/jazz-content-scheduler/index.html`
- ReleasePilot logo assets: `outputs/jazz-content-scheduler/assets/releasepilot-icon-512.png`, `outputs/jazz-content-scheduler/assets/releasepilot-wordmark-dark.png`, and `outputs/jazz-content-scheduler/assets/releasepilot.ico`
- Scheduler UI logic and styling
- Local backend for rendering, R2 upload, and Meta publishing
- PowerShell helpers for starting the local app
- Safe example environment file: `outputs/jazz-content-scheduler/backend/.env.example`

## What is not included

Generated reels, API run logs, local catalogue exports with machine-specific paths, and real secrets are intentionally ignored by Git.

## Start locally

1. Double-click `ReleasePilot.exe`.
2. If needed, the older launcher still works from PowerShell:

```powershell
.\start-jazz-scheduler.bat
```

3. Open the dashboard shown by the starter script.

## Backend setup

Copy:

```text
outputs/jazz-content-scheduler/backend/.env.example
```

to:

```text
outputs/jazz-content-scheduler/backend/.env
```

Then add your own Meta and Cloudflare R2 values locally. Do not commit `.env`.

## Validation

Run the dependency-free checks before changing the publishing flow:

```powershell
npm test
npm run check:js
node outputs/jazz-content-scheduler/backend/server.mjs --check-readiness
```
