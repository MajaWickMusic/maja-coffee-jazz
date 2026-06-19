param(
  [int]$Count = 10,
  [int]$Seconds = 20,
  [int]$MinSeconds = 0,
  [int]$MaxSeconds = 0,
  [int]$FadeOutSeconds = 4,
  [int]$RenderTimeoutSeconds = 300,
  [int]$CooldownDays = 90,
  [string]$RenderPreset = "balanced",
  [string]$TemplateMode = "rotate",
  [string]$ProgressPath = ""
)

$ErrorActionPreference = "Stop"

function Test-LocalPath {
  param([string]$Value)
  return $Value -match '^[A-Z]:\\' -and (Test-Path -LiteralPath $Value)
}

function Safe-Date {
  param([string]$Value)
  if (-not $Value) { return $null }
  try { return [datetime]$Value } catch { return $null }
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
    [int]$Take
  )

  $selected = New-Object System.Collections.Generic.List[object]
  $usedIsrc = @{}
  $albumBuckets = @{}
  foreach ($track in ($Tracks | Sort-Object { Get-Random })) {
    $album = if ($track.Album) { [string]$track.Album } else { "Unknown album" }
    if (-not $albumBuckets[$album]) {
      $albumBuckets[$album] = New-Object System.Collections.Generic.List[object]
    }
    $albumBuckets[$album].Add($track)
  }

  foreach ($album in ($albumBuckets.Keys | Sort-Object { Get-Random })) {
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

  $remaining = @($Tracks | Where-Object { -not ($_.ISRC -and $usedIsrc[$_.ISRC]) } | Sort-Object { Get-Random })
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
$CatalogPath = Join-Path $ScriptDir "majas-coffee-jazz-zone-full-catalog-with-files.csv"
$HistoryPath = Join-Path $ScriptDir "render-history.csv"
$QueueDir = Join-Path $ScriptDir "queue-runs"
$TempCatalogPath = Join-Path $QueueDir "next-render-selection.csv"
$RendererPath = Join-Path $WorkspaceRoot "work\render-reel-batch.ps1"

New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null
Write-RenderProgress -Stage "selecting" -Current 0 -Total $Count -Message "Selecting tracks for the next review batch..."

if (-not (Test-Path -LiteralPath $CatalogPath)) {
  throw "Catalog not found: $CatalogPath"
}

if (-not (Test-Path -LiteralPath $RendererPath)) {
  throw "Renderer not found: $RendererPath"
}

$catalog = Import-Csv -LiteralPath $CatalogPath -Encoding UTF8
$eligible = @(
  $catalog | Where-Object {
    (Test-LocalPath $_.'Audio file or URL') -and
    (Test-LocalPath $_.'Artwork URL')
  }
)

if (-not $eligible.Count) {
  throw "No eligible local tracks found with both audio and artwork."
}

$history = @()
if (Test-Path -LiteralPath $HistoryPath) {
  $history = @(Import-Csv -LiteralPath $HistoryPath -Encoding UTF8)
}

$cutoff = (Get-Date).AddDays(-1 * $CooldownDays)
$recentIsrc = @{}
foreach ($entry in $history) {
  $renderedAt = Safe-Date $entry.RenderedAt
  if ($entry.ISRC -and $renderedAt -and $renderedAt -gt $cutoff) {
    $recentIsrc[$entry.ISRC] = $true
  }
}

$freshEligible = @($eligible | Where-Object { -not $recentIsrc[$_.ISRC] })
$selection = @(Select-DiverseTracks -Tracks $freshEligible -Take $Count)

if ($selection.Count -lt $Count) {
  $needed = $Count - $selection.Count
  $selectedIsrc = @{}
  foreach ($track in $selection) { $selectedIsrc[$track.ISRC] = $true }
  $fallbackPool = @($eligible | Where-Object { -not $selectedIsrc[$_.ISRC] })
  $fallback = @(Select-DiverseTracks -Tracks $fallbackPool -Take $needed)
  $selection = @($selection + $fallback)
}

if (-not $selection.Count) {
  throw "No tracks selected for rendering."
}

Write-RenderProgress -Stage "rendering" -Current 0 -Total $selection.Count -Message "Selected $($selection.Count) tracks. Starting video render..."

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
    $_ | Select-Object *, @{Name = "RenderSeconds"; Expression = { $duration } }
  }
)

$selectionWithDurations | Export-Csv -Path $TempCatalogPath -NoTypeInformation -Encoding UTF8

$renderOutput = & powershell -ExecutionPolicy Bypass -File $RendererPath `
  -Count $selection.Count `
  -Seconds $Seconds `
  -FadeOutSeconds $FadeOutSeconds `
  -RenderTimeoutSeconds $RenderTimeoutSeconds `
  -RenderPreset $RenderPreset `
  -TemplateMode $TemplateMode `
  -ProgressPath $ProgressPath `
  -CatalogPath $TempCatalogPath

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
foreach ($entry in $history) { $historyRows.Add($entry) }
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
  })
}

$historyRows | Export-Csv -Path $HistoryPath -NoTypeInformation -Encoding UTF8

Write-Output "Rendered next draft Reels: $($rendered.Count)"
Write-Output "Batch folder: $batchFolder"
Write-Output "Review manifest: $manifestPath"
Write-RenderProgress -Stage "complete" -Current $rendered.Count -Total $selection.Count -Message "Render complete."
Write-Output "History: $HistoryPath"
