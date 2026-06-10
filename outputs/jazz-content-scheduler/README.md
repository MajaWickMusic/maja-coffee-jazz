# Jazz Content Scheduler Prototype

This is a dependency-free starter dashboard for planning Instagram Reels, Stories, and image/text posts from a large music catalog.

## What works now

- Paste/import track rows.
- Choose a CSV file directly in the browser.
- Store track, album, artwork, audio source, store URL, mood, and BPM.
- Keep ISRCs in the catalog and generated queue.
- Randomly rotate tracks with cooldown rules.
- Set separate timers for Reels, Stories, and image/text posts.
- Generate a draft content queue.
- Export that queue as JSON for a future video-rendering/publishing service.
- Render safe-fit 9:16 Reel drafts in batches.
- Render mixed-length Reels with automatic audio fade-out.
- Rotate visual templates with waveform, frequency, sparkle, and minimal-cover treatments.
- Import rendered batch manifests into the Review dashboard.
- Approve, reject, mark posted, and edit captions/hashtags in the Review dashboard.
- Configure posting options in the Posting dashboard and export those settings.
- Import approved Reels into the Publish Queue dashboard.
- Edit platform, scheduled time, caption, hashtags, public MP4 URL, and handoff status.
- Check approved Reel items against the guarded local Meta/Instagram publishing bridge.
- Export a final posting package for manual upload or Meta/Instagram API publishing.
- Build local Meta Business Suite upload folders from a posting package.
- Open the next pending manual post folder and copy caption/hashtags to the clipboard.
- Track Instagram/Meta API readiness in the Instagram Setup dashboard.
- Export a non-secret Instagram setup config for the future backend.
- Run a local backend readiness checker for Meta/Instagram setup.

## Current catalog source

- Cleaned full catalog file: `majas-coffee-jazz-zone-full-catalog.csv`
- Missing artwork report: `majas-coffee-jazz-zone-missing-artwork-albums.csv`
- Catalog with local audio/artwork file paths: `majas-coffee-jazz-zone-full-catalog-with-files.csv`
- Missing audio report: `majas-coffee-jazz-zone-missing-audio.csv`
- Local artwork map: `majas-coffee-jazz-zone-local-artwork-map.csv`
- Batch renderer script: `work/render-reel-batch.ps1`
- Queue-aware render script: `render-next-draft-reels.ps1`
- Render history file: `render-history.csv`
- Finished example Reel: `finished-example-reel.mp4`
- Spotify artist source: `https://open.spotify.com/artist/0S6IzRQRufNIAl55OxmCSG`
- SoundCloud source: `https://soundcloud.com/majascoffeejazzzone`
- Imported tracks in current cleaned export: 775
- Albums in current cleaned export: 41
- Albums with artwork in current cleaned export: 14
- Albums missing artwork in current cleaned export: 27
- Tracks matched by title to local audio files: 677
- Tracks mapped by album-order fallback: 35
- Tracks mapped by global unused-file fallback: 63
- Tracks still missing local audio matches: 0
- Local image files found across album folders: 70

## Reel templates

- `safe-fit-waveform-sparkles`: protected artwork, blurred background, waveform, subtle sparkles.
- `frequency-bars`: protected artwork with animated audio frequency bars.
- `minimal-cover`: protected artwork with a quieter blurred background.
- `lounge-glow`: protected artwork with soft waveform and warmer sparkle movement.

## Queue rendering

Day-to-day startup:

```text
start-jazz-scheduler.bat
```

This starts the local backend and opens the dashboard.

Run `render-next-draft-reels.ps1` to select the next eligible tracks, avoid recent repeats, render draft Reels, and update `render-history.csv`.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File outputs\jazz-content-scheduler\render-next-draft-reels.ps1 -Count 7 -MinSeconds 20 -MaxSeconds 30 -FadeOutSeconds 4 -RenderTimeoutSeconds 300 -CooldownDays 90 -RenderPreset balanced -TemplateMode rotate
```

`MinSeconds` and `MaxSeconds` make each Reel in the batch alternate length randomly. `FadeOutSeconds` fades the audio at the end so it does not stop abruptly.
`RenderTimeoutSeconds` prevents one slow/problem track from trapping the whole batch.

Render presets:

- `fast`: simpler templates, faster encoding, best for larger batches.
- `balanced`: normal rotation and sensible file size.
- `high`: stronger quality, slower rendering.

## Review workflow

1. Render a batch with `render-next-draft-reels.ps1`.
2. Open `index.html`.
3. Go to Review.
4. Import the batch `review-manifest.csv` or `review-manifest.json`.
5. Mark Reels as draft, approved, rejected, or posted.
6. Export approved Reels when ready for the publishing step.

## Posting GUI

The Posting section stores local publishing preferences:

- approval mode
- Instagram account label
- default post type
- baked-in original audio setting
- caption style
- hashtag set
- timezone and posting window
- content mix
- cooldown days

These settings do not publish anything yet. They are the approval-safe configuration layer for the future Meta/Instagram connection.

## Publishing queue workflow

1. In Review, export approved Reels.
2. Go to Publish Queue.
3. Import `approved-reels.json`.
4. Set platform, scheduled time, and status for each item.
5. Click `Upload approved to R2`.
6. Click `Create IG containers`.

The older export/manual package buttons are still available as fallback tools.

The posting package is the clean handoff file for either manual posting or the local Meta/Instagram bridge. Instagram cannot publish from a private Windows file path, so each item needs a public HTTPS MP4 URL before the API can create a Reel container.

## Manual Meta Business Suite package

To keep everything local, export `posting-package.json` from the Publish Queue and run:

```powershell
powershell -ExecutionPolicy Bypass -File outputs\jazz-content-scheduler\package-manual-posting.ps1 -PackageJson "$env:USERPROFILE\Downloads\posting-package.json"
```

This creates a dated folder under:

```text
outputs\jazz-content-scheduler\manual-posting-packages\
```

Each approved/ready item gets its own folder with:

- `reel.mp4`
- preview image
- `caption.txt`
- `hashtags.txt`
- `upload-notes.txt`
- a master `posting-tracker.csv`

Use those files in Meta Business Suite, then update the tracker/status in the dashboard after posting.

To speed up manual posting, run:

```powershell
powershell -ExecutionPolicy Bypass -File outputs\jazz-content-scheduler\open-next-manual-post.ps1 -OpenMetaBusinessSuite
```

This opens the next pending Reel folder, copies the combined caption and hashtags to the clipboard, and opens Meta Business Suite. You still choose/upload `reel.mp4` and confirm the post or schedule time yourself.

## Cloudflare R2 upload

For Instagram API publishing, each MP4 needs a public HTTPS URL. Cloudflare R2 can host those files.

Add these values to `backend/.env`:

```env
R2_ACCOUNT_ID=
R2_BUCKET=
R2_PUBLIC_URL=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

Keep `R2_SECRET_ACCESS_KEY` private and only store it in `.env`.

After exporting `posting-package.json`, upload the Reel MP4s to R2:

```powershell
powershell -ExecutionPolicy Bypass -File outputs\jazz-content-scheduler\upload-reels-to-r2.ps1 -FromClipboard
```

This writes `posting-package-uploaded.json`, with `publicVideoUrl` filled for each uploaded Reel. That uploaded package is the handoff into the Instagram API publishing step.

## Instagram container creation

After R2 upload, create Instagram Reel media containers from the public MP4 URLs:

```powershell
powershell -ExecutionPolicy Bypass -File outputs\jazz-content-scheduler\create-instagram-containers.ps1
```

This reads:

```text
Downloads\posting-package-uploaded.json
```

By default it stays in dry-run unless `PUBLISHING_MODE=test` is set in `backend/.env`. Dry-run writes a `posting-package-uploaded-containers.json` preview showing what would be sent to Meta.

When test mode is enabled, this creates media containers only. Publishing those containers remains a separate final confirmation step.

## GUI API workflow

The dashboard now has buttons for:

- creating a ready-to-review Reel batch
- sending approved Reels into the Publish Queue
- uploading approved MP4s to Cloudflare R2
- creating Instagram Reel media containers from the R2 URLs

The next phase is the unattended scheduler: it will keep a local schedule file and publish due items at their selected times, provided the PC and backend are running.

## Local scheduled publisher

After Instagram containers are created, the Publish Queue can now:

- publish due containers immediately with `Publish due now`
- run a local auto publisher with `Start auto publisher`

The auto publisher checks every 5 minutes and publishes only items whose scheduled time has arrived. Keep the backend PowerShell window and dashboard open while it is running.

The publisher now creates the Instagram container at publish time when needed, using the saved R2 `publicVideoUrl`, then immediately calls Instagram `media_publish`. Pre-creating containers is optional and mainly useful for testing.

## Instagram/Meta setup status

Known setup details:

- Instagram handle: `@majascoffeejazzzone`
- Instagram account type: Creator
- Facebook Page: `Maja's Coffee Jazz Zone`
- Facebook Page link: `https://www.facebook.com/profile.php?id=61590381973296&sk=about`
- Meta for Developers account: available
- Meta app: `1365265765442781`
- Approval before publishing: required

The Instagram Setup dashboard tracks:

- Creator/Business account readiness
- Facebook Page link readiness
- Meta app status
- required permissions
- backend requirement for secrets/tokens
- publishing mode
- non-secret environment placeholders

Do not store access tokens, app secrets, or passwords in the static dashboard. Those belong in a backend `.env` file once the publisher service exists.

## Backend readiness checker

Backend folder:

```text
backend/
```

Create a local `.env`:

```powershell
powershell -ExecutionPolicy Bypass -File outputs\jazz-content-scheduler\backend\create-env.ps1
```

Run a one-shot readiness check:

```powershell
C:\Users\willi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe outputs\jazz-content-scheduler\backend\server.mjs --check-readiness
```

Start the local backend:

```powershell
cd outputs\jazz-content-scheduler\backend
powershell -ExecutionPolicy Bypass -File .\start-backend.ps1
```

The backend performs readiness checks and has a guarded Reel container endpoint. It stays in dry-run/manual mode until credentials, permissions, `IG_USER_ID`, approval flow, and public media hosting are verified.

For the rest of the 500+ catalog, the next best import route is either a distributor export with ISRC/UPC/release fields or Spotify API enrichment from the artist/releases list.

## Recommended data source order

1. Distributor export or your own master catalog.
2. Spotify API for metadata and artwork checks.
3. YouTube Data API for official video/topic matching.
4. SoundCloud API or account export if available.
5. Manual CSV import for anything missing.

## Important Instagram note

The future publisher should render your selected track audio directly into the Reel video. If the same master is already delivered to Meta/Instagram through your distributor, Instagram can recognize it as your official music catalog item.

## Future phases

- Add real file/audio upload.
- Add artwork validation and automatic album mapping.
- Add FFmpeg-based 9:16 video rendering.
- Add AI/generative visual template options.
- Add Instagram Graph API publishing.
- Add approval mode before publishing.
- Add analytics-based weighting so stronger songs and visuals appear more often.
