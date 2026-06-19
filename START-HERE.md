# Start Here - Jazz Content Scheduler

This is the clean Windows app package for Jazz Content Scheduler.

## Install

1. Extract the zip.
2. Double-click `Install Jazz Scheduler.bat`.
3. Use the new **Jazz Scheduler** desktop shortcut or Start Menu shortcut.

The installer does not need admin rights. It installs to:

`%LOCALAPPDATA%\Programs\MajaCoffeeJazzScheduler`

## Open Without Installing

You can also run it directly from the extracted folder:

1. Double-click `start-jazz-scheduler.bat`.
2. The backend starts.
3. The dashboard opens in an app-style Edge/Chrome window.

## First Setup

1. Follow the First-Time Setup wizard.
2. Choose the artist name.
3. Choose the audio folder.
4. Choose the artwork folder, or leave it blank if artwork is inside album folders.
5. Run **Scan library**.
6. Review missing artwork, duplicates, and unsupported files.
7. Add private Meta and R2 values to `outputs/jazz-content-scheduler/backend/.env`.
8. Use **Instagram Setup > Check Meta health**.
9. Generate a batch, review it, approve it, upload videos, then schedule publishing.

## Private Files Not Included

The release package does not include:

- real `.env` files
- Meta tokens or app secrets
- R2 keys
- rendered videos
- posting plans
- API logs
- personal catalog exports with local file paths

## Requirements

- Windows
- PowerShell
- Edge or Chrome
- Node.js installed from https://nodejs.org
- FFmpeg available on PATH for rendering
- Meta Developer app/token for automatic publishing
- Cloudflare R2 or equivalent public HTTPS video hosting
