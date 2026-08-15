# Approved Visual Sources

Place only owned, CC0, public-domain, or commercial-use licensed atmosphere videos in:

`approved-videos/`

The renderer uses these files for the second and third Shorts in each three-Short track campaign:

1. Artwork + music visualiser
2. Coffee / jazz atmosphere video
3. Relaxing / study atmosphere video

Use `approved-visual-sources.csv` to record license notes.

Pexels support is available from the app's Visual Sources screen after `PEXELS_API_KEY` is added to `backend/.env`. Downloaded Pexels clips are saved into `approved-videos/` and logged into the CSV with source, creator, license, and attribution notes.

Use `album-visual-themes.csv` to guide automatic Pexels searches and visual matching per album. The renderer reads this file during batch creation.

- `Mood`: short emotional direction, such as `rainy`, `warm`, `noir`, `bright`, `luxury`, or `peaceful`.
- `Theme`: the visual/world idea, such as `Paris cafe`, `late-night city`, `bossa beach lounge`, or `wooden acoustic room`.
- `Style`: music/style cue to use in captions and planning, such as `bossa cafe jazz`, `Hammond organ jazz`, or `lofi study jazz`.
- `Scene`: plain-language visual direction, such as `rain on cafe windows with warm light inside`.
- `Instruments`: visible instrument/performance cues to boost searches, such as `piano hands | saxophone player | upright bass | jazz drummer`.
- `SearchTerms`: Pexels search phrases separated with ` | `, such as `rainy coffee shop | Paris cafe night | candlelit table`.
- `NegativeTerms`: optional notes for what to avoid. This is kept for review/planning and future filtering.
- `Notes`: anything useful for the visual direction.

Blank album rows are safe. The renderer will fall back to the track title, album title, artwork filename, and built-in mood rules.

Do not add unlicensed videos, branded scenes, third-party music videos, album covers, film clips, or footage where commercial use is unclear.
