# ReleasePilot Backend

This is the local backend shell for ReleasePilot readiness checks, media rendering support, uploads, and guarded publishing.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill `META_APP_SECRET`, `META_ACCESS_TOKEN`, and then `IG_USER_ID` locally.
3. Keep `.env` private.
4. Start the service:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-backend.ps1
```

Then open:

```text
http://127.0.0.1:8787/health
http://127.0.0.1:8787/api/readiness
```

## Current Scope

- Load non-secret Instagram setup config.
- Check required local environment values.
- If a Meta access token is present, query Meta Graph API for token/page/permission readiness.
- Check approved queue items before Instagram API publishing.
- Keep live publishing disabled until readiness checks pass, a public MP4 URL is available, and approval is confirmed.

## Publishing bridge

The browser app can send an approved queue item to:

```text
POST /api/publish/instagram/reel
```

Manual mode returns a dry-run preview. To create an Instagram Reel media container later, set:

```env
PUBLISHING_MODE=test
```

The endpoint requires:

- `IG_USER_ID`
- `META_ACCESS_TOKEN`
- approved or ready queue status
- public `https://` MP4 URL
- caption text

## Secrets

Never store app secrets or access tokens in `index.html`, localStorage, CSV/JSON exports, or chat. Use `.env` only.
