param(
  [int]$Count = 10,
  [int]$Seconds = 20,
  [int]$MinSeconds = 0,
  [int]$MaxSeconds = 0,
  [int]$FadeOutSeconds = 4,
  [int]$RenderTimeoutSeconds = 300,
  [int]$CooldownDays = 90,
  [string]$RenderPreset = "balanced",
  [string]$TemplateMode = "rotate"
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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$CatalogPath = Join-Path $ScriptDir "majas-coffee-jazz-zone-full-catalog-with-files.csv"
$HistoryPath = Join-Path $ScriptDir "render-history.csv"
$QueueDir = Join-Path $ScriptDir "queue-runs"
$TempCatalogPath = Join-Path $QueueDir "next-render-selection.csv"
$RendererPath = Join-Path $WorkspaceRoot "work\render-reel-batch.ps1"

New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null

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

$selection = @(
  $eligible |
    Where-Object { -not $recentIsrc[$_.ISRC] } |
    Sort-Object { Get-Random } |
    Select-Object -First $Count
)

if ($selection.Count -lt $Count) {
  $needed = $Count - $selection.Count
  $selectedIsrc = @{}
  foreach ($track in $selection) { $selectedIsrc[$track.ISRC] = $true }
  $fallback = @(
    $eligible |
      Where-Object { -not $selectedIsrc[$_.ISRC] } |
      Sort-Object { Get-Random } |
      Select-Object -First $needed
  )
  $selection = @($selection + $fallback)
}

if (-not $selection.Count) {
  throw "No tracks selected for rendering."
}

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
Write-Output "History: $HistoryPath"
