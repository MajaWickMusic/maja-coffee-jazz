param(
  [int]$Count = 10,
  [int]$Seconds = 20,
  [int]$MinSeconds = 0,
  [int]$MaxSeconds = 0,
  [int]$FadeOutSeconds = 4,
  [int]$RenderTimeoutSeconds = 300,
  [int]$CooldownDays = 90,
  [int]$ShortsPerTrack = 1,
  [string]$RenderPreset = "balanced",
  [string]$TemplateMode = "rotate",
  [string]$ProgressPath = "",
  [string]$CatalogPath = "",
  [string]$LibraryConfigPath = "",
  [string]$VisualAssetDir = "",
  [string]$VisualSourceManifestPath = "",
  [string]$AlbumThemePath = "",
  [string]$PerformancePresetPath = "",
  [switch]$AutoSourcePexels,
  [switch]$AutoSourcePixabay
)

$ErrorActionPreference = "Stop"

function Test-LocalPath {
  param([string]$Value)
  return $Value -match '^[A-Z]:\\' -and (Test-Path -LiteralPath $Value)
}

function Test-LocalImagePath {
  param([string]$Value)
  if (-not (Test-LocalPath $Value)) { return $false }
  $imageExtensions = @(".jpg", ".jpeg", ".png", ".webp")
  return $imageExtensions -contains ([IO.Path]::GetExtension($Value).ToLowerInvariant())
}

function Safe-Date {
  param([string]$Value)
  if (-not $Value) { return $null }
  try { return [datetime]$Value } catch { return $null }
}

function Safe-Slug {
  param([string]$Value)
  $slug = $Value.ToLowerInvariant()
  $slug = $slug -replace "'", ""
  $slug = $slug -replace '&', 'and'
  $slug = $slug -replace '[^a-z0-9]+', '-'
  $slug = $slug.Trim('-')
  if (-not $slug) { return "untitled" }
  return $slug
}

function Normalize-Key {
  param([string]$Value)
  if (-not $Value) { return "" }
  $key = $Value.ToLowerInvariant()
  $key = $key -replace '&', 'and'
  $key = $key -replace '[^a-z0-9]+', ''
  return $key
}

function Get-TextList {
  param([object]$Value)
  $items = New-Object System.Collections.Generic.List[string]
  if ($null -eq $Value) { return @() }

  if (($Value -is [System.Array]) -and -not ($Value -is [string])) {
    foreach ($entry in $Value) {
      if ($null -eq $entry) { continue }
      if ($entry -is [string]) {
        $text = $entry
      } elseif ($entry.PSObject.Properties["label"]) {
        $text = [string]$entry.label
      } elseif ($entry.PSObject.Properties["title"]) {
        $text = [string]$entry.title
      } else {
        $text = [string]$entry
      }
      foreach ($part in ($text -split '[,;|]')) {
        $trimmed = $part.Trim()
        if ($trimmed) { $items.Add($trimmed) }
      }
    }
  } elseif ($Value -is [string]) {
    foreach ($part in ($Value -split '[,;|]')) {
      $trimmed = $part.Trim()
      if ($trimmed) { $items.Add($trimmed) }
    }
  } elseif ($Value.PSObject.Properties["label"]) {
    $text = ([string]$Value.label).Trim()
    if ($text) { $items.Add($text) }
  }

  return @($items | Select-Object -Unique)
}

function Test-ContainsAnyNormalized {
  param(
    [string]$Haystack,
    [string[]]$Needles
  )
  $haystackKey = Normalize-Key $Haystack
  if (-not $haystackKey) { return $false }
  foreach ($needle in $Needles) {
    $needleKey = Normalize-Key $needle
    if ($needleKey -and ($haystackKey -like "*$needleKey*" -or $needleKey -like "*$haystackKey*")) {
      return $true
    }
  }
  return $false
}

function Get-AlbumThemeForTrack {
  param(
    [object]$Track,
    [hashtable]$ThemeByAlbum
  )
  if (-not $ThemeByAlbum) { return $null }
  $key = Normalize-Key ([string]$Track.Album)
  if ($key -and $ThemeByAlbum[$key]) { return $ThemeByAlbum[$key] }
  return $null
}

function Get-PerformanceTrackScore {
  param(
    [object]$Track,
    [object]$PerformancePreset,
    [hashtable]$ThemeByAlbum
  )
  if (-not $PerformancePreset) { return 0 }
  $theme = Get-AlbumThemeForTrack -Track $Track -ThemeByAlbum $ThemeByAlbum
  $album = [string]$Track.Album
  $text = @(
    [string]$Track.Title,
    $album,
    [string]$theme.Mood,
    [string]$theme.Theme,
    [string]$theme.Style,
    [string]$theme.Scene,
    [string]$theme.Instruments,
    [string]$theme.SearchTerms
  ) -join " "

  $score = 0
  foreach ($preferred in (Get-TextList $PerformancePreset.preferredAlbums)) {
    if ((Normalize-Key $album) -eq (Normalize-Key $preferred)) { $score += 80 }
  }
  foreach ($preferred in (Get-TextList $PerformancePreset.preferredStyles)) {
    if (Test-ContainsAnyNormalized -Haystack $text -Needles @($preferred)) { $score += 45 }
  }
  foreach ($preferred in (Get-TextList $PerformancePreset.preferredInstruments)) {
    if (Test-ContainsAnyNormalized -Haystack $text -Needles @($preferred)) { $score += 35 }
  }
  foreach ($preferred in (Get-TextList $PerformancePreset.preferredSearchTerms)) {
    if (Test-ContainsAnyNormalized -Haystack $text -Needles @($preferred)) { $score += 30 }
  }
  foreach ($preferred in (Get-TextList $PerformancePreset.preferredVisualTypes)) {
    if (Test-ContainsAnyNormalized -Haystack $text -Needles @($preferred)) { $score += 12 }
  }

  return $score
}

function Add-MapValue {
  param(
    [hashtable]$Map,
    [string]$Key,
    [string]$Value
  )
  if (-not $Key -or -not $Value) { return }
  if (-not $Map[$Key]) {
    $Map[$Key] = New-Object System.Collections.Generic.List[string]
  }
  $Map[$Key].Add($Value)
}

function Get-ConfiguredArtworkRoot {
  param(
    [string]$ScriptDir,
    [string]$PreferredConfigPath = ""
  )
  $configPaths = @(
    $PreferredConfigPath,
    (Join-Path $ScriptDir "backend\config\local-library.json"),
    (Join-Path $ScriptDir "backend\config\user-config.json")
  ) | Where-Object { $_ }

  foreach ($configPath in $configPaths) {
    if (-not (Test-Path -LiteralPath $configPath)) { continue }
    try {
      $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $root = if ($config.artworkRoot) { [string]$config.artworkRoot } elseif ($config.setupWizard -and $config.setupWizard.artworkRoot) { [string]$config.setupWizard.artworkRoot } else { "" }
      if ($root -and (Test-Path -LiteralPath $root)) { return (Resolve-Path -LiteralPath $root).Path }
    } catch {}
  }
  return ""
}

function New-ArtworkIndex {
  param([string]$Root)
  $index = @{
    ByName = @{}
    ByFolder = @{}
    All = @()
  }
  if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { return $index }

  $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { Test-LocalImagePath $_.FullName } |
    Select-Object -ExpandProperty FullName)
  $index.All = $files
  foreach ($file in $files) {
    Add-MapValue -Map $index.ByName -Key (Normalize-Key ([IO.Path]::GetFileNameWithoutExtension($file))) -Value $file
    Add-MapValue -Map $index.ByFolder -Key (Normalize-Key (Split-Path -Leaf (Split-Path -Parent $file))) -Value $file
  }
  return $index
}

function Find-ConfiguredArtwork {
  param(
    [object]$Track,
    [hashtable]$ArtworkIndex
  )
  if (-not $ArtworkIndex -or -not $ArtworkIndex.All.Count) { return "" }

  $audio = [string]$Track.'Audio file or URL'
  $parent = if ($audio -and (Test-Path -LiteralPath $audio)) { Split-Path -Leaf (Split-Path -Parent $audio) } else { "" }
  $grandParent = if ($audio -and (Test-Path -LiteralPath $audio)) { Split-Path -Leaf (Split-Path -Parent (Split-Path -Parent $audio)) } else { "" }
  $candidates = @(
    [string]$Track.Album,
    [string]$Track.Title,
    $grandParent,
    $parent,
    "cover",
    "folder",
    "artwork"
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    $key = Normalize-Key $candidate
    if ($ArtworkIndex.ByName[$key]) { return $ArtworkIndex.ByName[$key][0] }
    if ($ArtworkIndex.ByFolder[$key]) { return $ArtworkIndex.ByFolder[$key][0] }
  }

  $albumKey = Normalize-Key ([string]$Track.Album)
  if ($albumKey) {
    foreach ($file in $ArtworkIndex.All) {
      $fileKey = Normalize-Key ([IO.Path]::GetFileNameWithoutExtension($file))
      $folderKey = Normalize-Key (Split-Path -Leaf (Split-Path -Parent $file))
      if ($fileKey -like "*$albumKey*" -or $albumKey -like "*$fileKey*" -or $folderKey -like "*$albumKey*" -or $albumKey -like "*$folderKey*") {
        return $file
      }
    }
  }

  return ""
}

function Find-AlbumFolderArtwork {
  param([object]$Track)
  $audio = [string]$Track.'Audio file or URL'
  if (-not $audio -or -not (Test-Path -LiteralPath $audio)) { return "" }

  $folders = New-Object System.Collections.Generic.List[string]
  $current = Split-Path -Parent $audio
  for ($i = 0; $i -lt 3 -and $current -and (Test-Path -LiteralPath $current); $i += 1) {
    $folders.Add($current)
    $current = Split-Path -Parent $current
  }

  $preferred = @("cover", "folder", "front", "artwork", "album")
  $imageExtensions = @(".jpg", ".jpeg", ".png", ".webp")
  foreach ($folder in $folders) {
    $images = @(Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue | Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() })
    if (-not $images.Count) { continue }

    foreach ($name in $preferred) {
      $match = $images | Where-Object { (Normalize-Key $_.BaseName) -eq $name } | Select-Object -First 1
      if ($match) { return $match.FullName }
    }

    $albumKey = Normalize-Key ([string]$Track.Album)
    if ($albumKey) {
      $match = $images | Where-Object {
        $imageKey = Normalize-Key $_.BaseName
        $imageKey -like "*$albumKey*" -or $albumKey -like "*$imageKey*"
      } | Select-Object -First 1
      if ($match) { return $match.FullName }
    }

    return $images[0].FullName
  }

  return ""
}

function Export-EmbeddedArtwork {
  param(
    [object]$Track,
    [string]$Directory
  )

  $audio = [string]$Track.'Audio file or URL'
  if (-not $audio -or -not (Test-Path -LiteralPath $audio)) { return "" }
  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  $slug = Safe-Slug "$($Track.Album)-$($Track.Title)-embedded-cover"
  $path = Join-Path $Directory "$slug.jpg"
  if (Test-LocalImagePath $path) { return (Resolve-Path -LiteralPath $path).Path }

  try {
    & ffmpeg -y -hide_banner -loglevel error -i $audio -map 0:v:0 -frames:v 1 $path | Out-Null
    if (Test-LocalImagePath $path) { return (Resolve-Path -LiteralPath $path).Path }
  } catch {}

  return ""
}

function Test-AudioLooksHealthy {
  param([string]$AudioPath)
  if (-not (Test-LocalPath $AudioPath)) { return $false }
  try {
    $json = & ffprobe -v error -select_streams a:0 -show_entries format=duration,bit_rate -of json $AudioPath | ConvertFrom-Json
    $duration = [double]($json.format.duration)
    $bitRate = [double]($json.format.bit_rate)
    if ($duration -gt 1800) { return $false }
    if ($bitRate -gt 0 -and $bitRate -lt 64000) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Test-HardBannedTrack {
  param([object]$Track)
  $key = "$(Normalize-Key $Track.Title)|$(Normalize-Key $Track.Album)"
  $banned = @(
    "nightcapfugue|themikemckenzietriomidnightatthekeys",
    "ashesintheashtray|themikemckenzietriomidnightatthekeys",
    "awhisperindminor|themikemckenzietriomidnightatthekeys",
    "fusionofthetwominds|fusionoftwominds",
    "softetudeincream|thechambersessions",
    "steamandsaxophones|majascoffeejazzmomentspt2"
  )
  return $banned -contains $key
}

function New-FallbackArtwork {
  param(
    [object]$Track,
    [string]$Directory
  )

  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  $title = [string]$Track.Title
  $album = [string]$Track.Album
  $slug = Safe-Slug "$album-$title"
  $path = Join-Path $Directory "$slug.png"
  if (Test-Path -LiteralPath $path) { return (Resolve-Path -LiteralPath $path).Path }
  Add-Type -AssemblyName System.Drawing

  $bitmap = New-Object System.Drawing.Bitmap 1080, 1080
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(48, 35, 70))

  $brushA = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 0, 0, 1080, 1080),
    [System.Drawing.Color]::FromArgb(84, 51, 135),
    [System.Drawing.Color]::FromArgb(25, 33, 50),
    35
  )
  $graphics.FillRectangle($brushA, 0, 0, 1080, 1080)

  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(219, 190, 255))
  $muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 231, 245))
  $small = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Regular)
  $large = New-Object System.Drawing.Font("Segoe UI", 68, [System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord

  $graphics.DrawString("Maja's Coffee Jazz Zone", $small, $accent, (New-Object System.Drawing.RectangleF 90, 120, 900, 90), $format)
  $graphics.DrawString($title, $large, $muted, (New-Object System.Drawing.RectangleF 90, 365, 900, 220), $format)
  $graphics.DrawString($album, $small, $accent, (New-Object System.Drawing.RectangleF 130, 690, 820, 130), $format)
  $graphics.DrawEllipse((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(95, 219, 190, 255), 4)), 190, 190, 700, 700)

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  return (Resolve-Path -LiteralPath $path).Path
}

function Write-RenderProgress {
  param(
    [string]$Stage,
    [int]$Current,
    [int]$Total,
    [string]$Message
  )
  if (-not $ProgressPath) { return }
  $percent = if ($Total -gt 0) { [Math]::Min(100, [Math]::Round(($Current / $Total) * 100)) } else { 0 }
  [pscustomobject]@{
    stage = $Stage
    current = $Current
    total = $Total
    percent = $percent
    message = $Message
    updatedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $ProgressPath -Encoding UTF8
}

function Select-DiverseTracks {
  param(
    [object[]]$Tracks,
    [int]$Take,
    [object]$PerformancePreset = $null,
    [hashtable]$ThemeByAlbum = @{}
  )

  $selected = New-Object System.Collections.Generic.List[object]
  $usedIsrc = @{}
  $albumBuckets = @{}
  $albumScores = @{}
  $orderedTracks = if ($PerformancePreset) {
    @($Tracks | Sort-Object @{ Expression = { -1 * (Get-PerformanceTrackScore -Track $_ -PerformancePreset $PerformancePreset -ThemeByAlbum $ThemeByAlbum) } }, @{ Expression = { Get-Random } })
  } else {
    @($Tracks | Sort-Object { Get-Random })
  }

  foreach ($track in $orderedTracks) {
    $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
    if (-not $albumBuckets[$album]) {
      $albumBuckets[$album] = New-Object System.Collections.Generic.List[object]
    }
    $albumBuckets[$album].Add($track)
    $score = Get-PerformanceTrackScore -Track $track -PerformancePreset $PerformancePreset -ThemeByAlbum $ThemeByAlbum
    if (-not $albumScores[$album] -or $score -gt $albumScores[$album]) {
      $albumScores[$album] = $score
    }
  }

  $albumOrder = if ($PerformancePreset) {
    @($albumBuckets.Keys | Sort-Object @{ Expression = { -1 * [double]$albumScores[$_] } }, @{ Expression = { Get-Random } })
  } else {
    @($albumBuckets.Keys | Sort-Object { Get-Random })
  }

  foreach ($album in $albumOrder) {
    if ($selected.Count -ge $Take) { break }
    $track = $albumBuckets[$album][0]
    $selected.Add($track)
    if ($track.ISRC) { $usedIsrc[$track.ISRC] = $true }
  }

  $albumCounts = @{}
  foreach ($track in $selected) {
    $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
    $albumCounts[$album] = 1
  }

  $remaining = if ($PerformancePreset) {
    @($Tracks | Where-Object { -not ($_.ISRC -and $usedIsrc[$_.ISRC]) } | Sort-Object @{ Expression = { -1 * (Get-PerformanceTrackScore -Track $_ -PerformancePreset $PerformancePreset -ThemeByAlbum $ThemeByAlbum) } }, @{ Expression = { Get-Random } })
  } else {
    @($Tracks | Where-Object { -not ($_.ISRC -and $usedIsrc[$_.ISRC]) } | Sort-Object { Get-Random })
  }
  $maxPerAlbum = 2
  while ($selected.Count -lt $Take -and $remaining.Count) {
    $picked = $false
    foreach ($track in @($remaining)) {
      $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
      $countForAlbum = if ($albumCounts[$album]) { $albumCounts[$album] } else { 0 }
      if ($countForAlbum -ge $maxPerAlbum) { continue }

      $selected.Add($track)
      if ($track.ISRC) { $usedIsrc[$track.ISRC] = $true }
      $albumCounts[$album] = $countForAlbum + 1
      $remaining = @($remaining | Where-Object { $_.ISRC -ne $track.ISRC })
      $picked = $true
      break
    }

    if (-not $picked) {
      $maxPerAlbum += 1
    }
  }

  return @($selected | Select-Object -First $Take)
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
if (-not $CatalogPath) {
  $CatalogPath = Join-Path $ScriptDir "majas-coffee-jazz-zone-full-catalog-with-files.csv"
}
$HistoryPath = Join-Path $ScriptDir "render-history.csv"
$FeedbackPath = Join-Path $ScriptDir "rejection-feedback.csv"
$PostingPlanPath = Join-Path $ScriptDir "backend\config\posting-plan.json"
$RenderedReelsPath = Join-Path $ScriptDir "rendered-reels"
$QueueDir = Join-Path $ScriptDir "queue-runs"
$FallbackArtworkDir = Join-Path $QueueDir "fallback-artwork"
$TempCatalogPath = Join-Path $QueueDir "next-render-selection.csv"
$RendererPath = Join-Path $WorkspaceRoot "work\render-reel-batch.ps1"
$ArtworkRoot = Get-ConfiguredArtworkRoot -ScriptDir $ScriptDir -PreferredConfigPath $LibraryConfigPath
$ArtworkIndex = New-ArtworkIndex -Root $ArtworkRoot
$PerformancePreset = $null
if ($PerformancePresetPath -and (Test-Path -LiteralPath $PerformancePresetPath)) {
  try {
    $PerformancePreset = Get-Content -LiteralPath $PerformancePresetPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    $PerformancePreset = $null
  }
}
$ThemeByAlbum = @{}
if ($AlbumThemePath -and (Test-Path -LiteralPath $AlbumThemePath)) {
  try {
    foreach ($themeRow in @(Import-Csv -LiteralPath $AlbumThemePath -Encoding UTF8)) {
      $themeAlbum = if ($themeRow.PSObject.Properties["Album"]) { [string]$themeRow.Album } else { "" }
      $themeKey = Normalize-Key $themeAlbum
      if ($themeKey) { $ThemeByAlbum[$themeKey] = $themeRow }
    }
  } catch {}
}

New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null
$shortsPerTrackSafe = [Math]::Max(1, [Math]::Min(3, $ShortsPerTrack))
$trackCampaignCount = [Math]::Max(1, [Math]::Ceiling($Count / $shortsPerTrackSafe))
$presetLabel = if ($PerformancePreset) { " using the performance-led preset" } else { "" }
Write-RenderProgress -Stage "selecting" -Current 0 -Total $Count -Message "Selecting $trackCampaignCount track campaign(s) for $shortsPerTrackSafe Short variant(s) each$presetLabel..."

if (-not (Test-Path -LiteralPath $CatalogPath)) {
  throw "Catalog not found: $CatalogPath"
}

if (-not (Test-Path -LiteralPath $RendererPath)) {
  throw "Renderer not found: $RendererPath"
}

$catalog = Import-Csv -LiteralPath $CatalogPath -Encoding UTF8
$eligible = @($catalog | Where-Object { (Test-AudioLooksHealthy $_.'Audio file or URL') -and -not (Test-HardBannedTrack $_) })

if (-not $eligible.Count) {
  throw "No eligible local tracks found with local audio."
}

if (Test-Path -LiteralPath $FeedbackPath) {
  $feedback = @(Import-Csv -LiteralPath $FeedbackPath -Encoding UTF8)
  $blockedIsrc = @{}
  $blockedTitleAlbum = @{}

  foreach ($entry in $feedback) {
    $reason = ([string]$entry.Reason).ToLowerInvariant()
    $isMismatch = $reason -match "incorrect|wrong|mismatch|bad match|not the track|title|audio|artwork|cover"
    if (-not $isMismatch) { continue }

    $isrc = [string]$entry.ISRC
    if ($isrc) { $blockedIsrc[$isrc] = $true }

    $titleAlbumKey = "$(Normalize-Key $entry.Title)|$(Normalize-Key $entry.Album)"
    if ($titleAlbumKey -ne "|") { $blockedTitleAlbum[$titleAlbumKey] = $true }
  }

  if ($blockedIsrc.Count -or $blockedTitleAlbum.Count) {
    $filteredEligible = @($eligible | Where-Object {
      $trackIsrc = [string]$_.ISRC
      $trackKey = "$(Normalize-Key $_.Title)|$(Normalize-Key $_.Album)"
      -not ($trackIsrc -and $blockedIsrc[$trackIsrc]) -and -not $blockedTitleAlbum[$trackKey]
    })

    if ($filteredEligible.Count) {
      $removed = $eligible.Count - $filteredEligible.Count
      $eligible = $filteredEligible
      Write-RenderProgress -Stage "selecting" -Current 0 -Total $Count -Message "Applied rejection feedback and skipped $removed previously rejected mismatch item(s)."
    }
  }
}

$history = @()
if (Test-Path -LiteralPath $HistoryPath) {
  $history = @(Import-Csv -LiteralPath $HistoryPath -Encoding UTF8)
}

$cutoff = (Get-Date).AddDays(-1 * $CooldownDays)
$recentIsrc = @{}
$recentAlbums = @{}
foreach ($entry in $history) {
  $renderedAt = Safe-Date $entry.RenderedAt
  if ($entry.ISRC -and $renderedAt -and $renderedAt -gt $cutoff) {
    $recentIsrc[$entry.ISRC] = $true
  }
  if ($entry.Album -and $renderedAt -and $renderedAt -gt $cutoff) {
    $recentAlbums[$entry.Album] = $true
  }
}

$freshEligible = @($eligible | Where-Object { -not $recentIsrc[$_.ISRC] -and -not $recentAlbums[$_.Album] })
$trackFreshEligible = @($eligible | Where-Object { -not $recentIsrc[$_.ISRC] })
$selection = @(Select-DiverseTracks -Tracks $freshEligible -Take $trackCampaignCount -PerformancePreset $PerformancePreset -ThemeByAlbum $ThemeByAlbum)

if ($selection.Count -lt $trackCampaignCount) {
  $needed = $trackCampaignCount - $selection.Count
  $selectedIsrc = @{}
  foreach ($track in $selection) { $selectedIsrc[$track.ISRC] = $true }
  $fallbackPool = @($trackFreshEligible | Where-Object { -not $selectedIsrc[$_.ISRC] })
  if (-not $fallbackPool.Count) {
    $fallbackPool = @($eligible | Where-Object { -not $selectedIsrc[$_.ISRC] })
  }
  $fallback = @(Select-DiverseTracks -Tracks $fallbackPool -Take $needed -PerformancePreset $PerformancePreset -ThemeByAlbum $ThemeByAlbum)
  $selection = @($selection + $fallback)
}

if (-not $selection.Count) {
  throw "No tracks selected for rendering."
}

Write-RenderProgress -Stage "rendering" -Current 0 -Total ($selection.Count * $shortsPerTrackSafe) -Message "Selected $($selection.Count) track campaign(s). Starting $shortsPerTrackSafe Short variant(s) per track..."

$durationMin = if ($MinSeconds -gt 0) { $MinSeconds } else { $Seconds }
$durationMax = if ($MaxSeconds -gt 0) { $MaxSeconds } else { $durationMin }
if ($durationMax -lt $durationMin) {
  throw "MaxSeconds must be greater than or equal to MinSeconds."
}

$selectionWithDurations = @(
  $selection | ForEach-Object {
    $duration = if ($durationMax -gt $durationMin) {
      Get-Random -Minimum $durationMin -Maximum ($durationMax + 1)
    } else {
      $durationMin
    }
    $renderTrack = $_ | Select-Object *
    $albumFolderArtwork = Find-AlbumFolderArtwork -Track $renderTrack
    if ($albumFolderArtwork -and (Test-LocalImagePath $albumFolderArtwork)) {
      $renderTrack.'Artwork URL' = $albumFolderArtwork
    } elseif (-not (Test-LocalImagePath $renderTrack.'Artwork URL')) {
      $matchedArtwork = Export-EmbeddedArtwork -Track $renderTrack -Directory $FallbackArtworkDir
      if ($matchedArtwork -and -not (Test-LocalImagePath $matchedArtwork)) {
        $matchedArtwork = ""
      }
      if (-not $matchedArtwork) {
        $matchedArtwork = Find-ConfiguredArtwork -Track $renderTrack -ArtworkIndex $ArtworkIndex
      }
      $renderTrack.'Artwork URL' = if ($matchedArtwork) { $matchedArtwork } else { New-FallbackArtwork -Track $renderTrack -Directory $FallbackArtworkDir }
    }
    $performanceScore = Get-PerformanceTrackScore -Track $renderTrack -PerformancePreset $PerformancePreset -ThemeByAlbum $ThemeByAlbum
    $performanceBasis = if ($PerformancePreset -and $PerformancePreset.PSObject.Properties["basisVideos"]) {
      @(Get-TextList $PerformancePreset.basisVideos | Select-Object -First 3) -join " | "
    } else {
      ""
    }
    $renderTrack | Select-Object *,
      @{Name = "RenderSeconds"; Expression = { $duration } },
      @{Name = "PerformancePreset"; Expression = { if ($PerformancePreset) { "performance-led" } else { "" } } },
      @{Name = "PerformanceScore"; Expression = { $performanceScore } },
      @{Name = "PerformanceBasis"; Expression = { $performanceBasis } }
  }
)

$selectionWithDurations | Export-Csv -Path $TempCatalogPath -NoTypeInformation -Encoding UTF8

$rendererArgs = @(
  "-ExecutionPolicy", "Bypass",
  "-File", $RendererPath,
  "-Count", $selection.Count,
  "-Seconds", $Seconds,
  "-FadeOutSeconds", $FadeOutSeconds,
  "-RenderTimeoutSeconds", $RenderTimeoutSeconds,
  "-RenderPreset", $RenderPreset,
  "-TemplateMode", $TemplateMode,
  "-VariantsPerTrack", $shortsPerTrackSafe,
  "-VisualReusePlanPath", $PostingPlanPath,
  "-VisualReuseHistoryDir", $RenderedReelsPath,
  "-VisualReuseCooldownDays", "21",
  "-CatalogPath", $TempCatalogPath
)
if ($ProgressPath) {
  $rendererArgs += @("-ProgressPath", $ProgressPath)
}
if ($VisualAssetDir) {
  $rendererArgs += @("-VisualAssetDir", $VisualAssetDir)
}
if ($VisualSourceManifestPath) {
  $rendererArgs += @("-VisualSourceManifestPath", $VisualSourceManifestPath)
}
if ($AlbumThemePath) {
  $rendererArgs += @("-AlbumThemePath", $AlbumThemePath)
}
if ($AutoSourcePexels) {
  $rendererArgs += "-AutoSourcePexels"
}
if ($AutoSourcePixabay) {
  $rendererArgs += "-AutoSourcePixabay"
}

$renderOutput = & powershell @rendererArgs

$batchLine = $renderOutput | Where-Object { $_ -like "Batch folder:*" } | Select-Object -First 1
if (-not $batchLine) {
  throw "Renderer did not report a batch folder."
}

$batchFolder = ($batchLine -replace '^Batch folder:\s*', '').Trim()
$manifestPath = Join-Path $batchFolder "review-manifest.csv"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Review manifest not found: $manifestPath"
}

$rendered = @(Import-Csv -LiteralPath $manifestPath -Encoding UTF8)
$now = (Get-Date).ToString("o")
$historyRows = New-Object System.Collections.Generic.List[object]
foreach ($entry in $history) {
  $historyRows.Add([pscustomobject]@{
    RenderedAt = $entry.RenderedAt
    Status = $entry.Status
    Title = $entry.Title
    Album = $entry.Album
    ISRC = $entry.ISRC
    Template = $entry.Template
    DurationSeconds = $entry.DurationSeconds
    Video = $entry.Video
    Preview = $entry.Preview
    VariantIndex = $entry.VariantIndex
    VariantRole = $entry.VariantRole
    VisualAssetPath = $entry.VisualAssetPath
    VisualSourceUrl = $entry.VisualSourceUrl
    VisualSourceName = $entry.VisualSourceName
  })
}
foreach ($item in $rendered) {
  $historyRows.Add([pscustomobject]@{
    RenderedAt = $now
    Status = "draft"
    Title = $item.Title
    Album = $item.Album
    ISRC = $item.ISRC
    Template = $item.Template
    DurationSeconds = $item.DurationSeconds
    Video = $item.Video
    Preview = $item.Preview
    VariantIndex = $item.VariantIndex
    VariantRole = $item.VariantRole
    VisualAssetPath = $item.VisualAssetPath
    VisualSourceUrl = $item.VisualSourceUrl
    VisualSourceName = $item.VisualSourceName
  })
}

$historyRows | Export-Csv -Path $HistoryPath -NoTypeInformation -Encoding UTF8

Write-Output "Rendered next draft Reels: $($rendered.Count)"
Write-Output "Batch folder: $batchFolder"
Write-Output "Review manifest: $manifestPath"
Write-RenderProgress -Stage "complete" -Current $rendered.Count -Total ($selection.Count * $shortsPerTrackSafe) -Message "Render complete."
Write-Output "History: $HistoryPath"
