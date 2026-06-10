param(
  [string]$PackageJson = "posting-package.json",
  [string]$OutDir = "outputs\jazz-content-scheduler\manual-posting-packages",
  [switch]$FromClipboard
)

$ErrorActionPreference = "Stop"

function Resolve-PathSafe {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }
  $expanded = [Environment]::ExpandEnvironmentVariables($PathValue)
  if ([System.IO.Path]::IsPathRooted($expanded)) { return $expanded }
  return (Join-Path (Get-Location) $expanded)
}

function Safe-Name {
  param([string]$Value)
  $name = if ([string]::IsNullOrWhiteSpace($Value)) { "untitled" } else { $Value.Trim() }
  foreach ($char in [System.IO.Path]::GetInvalidFileNameChars()) {
    $name = $name.Replace($char, "-")
  }
  $name = $name -replace "\s+", " "
  $name = $name.Trim(" .-")
  if ($name.Length -gt 80) { $name = $name.Substring(0, 80).Trim(" .-") }
  if ([string]::IsNullOrWhiteSpace($name)) { return "untitled" }
  return $name
}

function Csv-Value {
  param($Value)
  $text = [string]$Value
  '"' + ($text -replace '"', '""') + '"'
}

function Value-Or {
  param($Value, [string]$Fallback = "")
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $Fallback }
  return [string]$Value
}

$packagePath = $null
if ($FromClipboard) {
  $packageText = Get-Clipboard -Raw
  if ([string]::IsNullOrWhiteSpace($packageText)) {
    throw "Clipboard is empty. In the app, click Export package, then Copy package JSON."
  }
} else {
  $packagePath = Resolve-PathSafe $PackageJson
  if (-not (Test-Path -LiteralPath $packagePath)) {
    throw "Package JSON not found: $PackageJson"
  }
  $packageText = Get-Content -LiteralPath $packagePath -Raw
}

try {
  $payload = $packageText | ConvertFrom-Json
} catch {
  throw "The package data is not valid JSON. In the app, click Export package, click Copy package JSON, then run this script again with -FromClipboard."
}
$items = @($payload.items)
if (-not $items.Count) {
  throw "No posting items found in $PackageJson"
}

$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$root = Resolve-PathSafe $OutDir
$runDir = Join-Path $root "manual-posting-$stamp"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$trackingRows = New-Object System.Collections.Generic.List[string]
$trackingRows.Add("Folder,Status,ScheduledFor,Platform,Title,Album,ISRC,VideoFile,PreviewFile,CaptionFile,HashtagsFile")

$indexLines = New-Object System.Collections.Generic.List[string]
$indexLines.Add("# Manual Posting Package")
$indexLines.Add("")
$indexLines.Add("Created: $(Get-Date -Format "yyyy-MM-dd HH:mm")")
$indexLines.Add("")
$indexLines.Add("Upload each MP4 in Meta Business Suite, paste the caption and hashtags, then mark the item as posted in posting-tracker.csv.")
$indexLines.Add("")

$counter = 1
foreach ($item in $items) {
  $status = (Value-Or $item.status "ready").ToLowerInvariant()
  if ($status -eq "held" -or $status -eq "rejected" -or $status -eq "posted") { continue }

  $scheduled = Value-Or $item.scheduledFor
  $datePart = if ($scheduled.Length -ge 10) { $scheduled.Substring(0, 10) } else { "unscheduled" }
  $title = Value-Or $item.title "Untitled"
  $album = Value-Or $item.album
  $folderName = "{0:000}-{1}-{2}" -f $counter, $datePart, (Safe-Name $title)
  $itemDir = Join-Path $runDir $folderName
  New-Item -ItemType Directory -Path $itemDir -Force | Out-Null

  $videoSource = Resolve-PathSafe (Value-Or $item.video)
  $previewSource = Resolve-PathSafe (Value-Or $item.preview)
  $artworkSource = Resolve-PathSafe (Value-Or $item.artwork)

  $videoFile = ""
  $previewFile = ""
  if ($videoSource -and (Test-Path -LiteralPath $videoSource)) {
    $videoFile = "reel.mp4"
    Copy-Item -LiteralPath $videoSource -Destination (Join-Path $itemDir $videoFile) -Force
  }
  if ($previewSource -and (Test-Path -LiteralPath $previewSource)) {
    $previewFile = "preview$([System.IO.Path]::GetExtension($previewSource))"
    Copy-Item -LiteralPath $previewSource -Destination (Join-Path $itemDir $previewFile) -Force
  }
  if ($artworkSource -and (Test-Path -LiteralPath $artworkSource)) {
    Copy-Item -LiteralPath $artworkSource -Destination (Join-Path $itemDir ("artwork" + [System.IO.Path]::GetExtension($artworkSource))) -Force
  }

  $caption = Value-Or $item.caption
  $hashtags = Value-Or $item.hashtags
  $captionPath = Join-Path $itemDir "caption.txt"
  $hashtagsPath = Join-Path $itemDir "hashtags.txt"
  $notesPath = Join-Path $itemDir "upload-notes.txt"

  Set-Content -LiteralPath $captionPath -Value $caption -Encoding UTF8
  Set-Content -LiteralPath $hashtagsPath -Value $hashtags -Encoding UTF8
  Set-Content -LiteralPath $notesPath -Value @(
    "Title: $title"
    "Album: $album"
    "ISRC: $($item.isrc)"
    "Platform: $($item.platform)"
    "Scheduled: $scheduled"
    "Status: $status"
    ""
    "Meta Business Suite steps:"
    "1. Create a Reel/post for @majascoffeejazzzone."
    "2. Upload reel.mp4."
    "3. Paste caption.txt, then hashtags.txt."
    "4. Choose the scheduled time above."
    "5. Mark this item as posted in posting-tracker.csv."
  ) -Encoding UTF8

  $trackingRows.Add(@(
    Csv-Value $folderName
    Csv-Value "pending"
    Csv-Value $scheduled
    Csv-Value $item.platform
    Csv-Value $title
    Csv-Value $album
    Csv-Value $item.isrc
    Csv-Value $videoFile
    Csv-Value $previewFile
    Csv-Value "caption.txt"
    Csv-Value "hashtags.txt"
  ) -join ",")

  $indexLines.Add("## $folderName")
  $indexLines.Add("")
  $indexLines.Add("- Title: $title")
  $indexLines.Add("- Album: $album")
  $indexLines.Add("- Scheduled: $scheduled")
  $indexLines.Add("- Platform: $($item.platform)")
  $indexLines.Add("- MP4: $videoFile")
  $indexLines.Add("")

  $counter++
}

Set-Content -LiteralPath (Join-Path $runDir "posting-tracker.csv") -Value $trackingRows -Encoding UTF8
Set-Content -LiteralPath (Join-Path $runDir "README.md") -Value $indexLines -Encoding UTF8

Write-Output "Created manual posting package:"
Write-Output $runDir
