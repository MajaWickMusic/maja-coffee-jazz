# Start Here - Jazz Content Scheduler

This release is the clean app package. It does not include private Meta tokens, R2 keys, rendered videos, local logs, or a personal posting plan.

## Open the app

1. Extract the zip.
2. Double-click `start-jazz-scheduler.bat`.
3. The backend starts and the dashboard opens in Edge/Chrome.
4. If this is a new setup, follow the First-Time Setup wizard.

## First setup

1. Choose your artist/brand name.
2. Choose your audio folder.
3. Choose your artwork folder, or leave it blank if artwork is inside album folders.
4. Run Scan library.
5. Review missing artwork, duplicate titles, and unsupported files.
6. Add Meta and Cloudflare R2 values in `outputs/jazz-content-scheduler/backend/.env`.
7. Use Instagram Setup > Check Meta health.
8. Generate a review batch, approve Reels, upload videos, then schedule posts.

## Private files not included

- `outputs/jazz-content-scheduler/backend/.env`
- `outputs/jazz-content-scheduler/backend/config/*.json`
- rendered reels
- API logs
- posting plans
- local catalog exports with personal file paths

## Requirements

- Windows
- PowerShell
- Edge or Chrome
- Node.js, or the Codex bundled runtime if running from this existing Codex environment
- FFmpeg available on PATH for rendering
- Meta Developer app/token for automatic publishing
- Cloudflare R2 or equivalent public HTTPS video hosting
