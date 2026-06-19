param(
  [string]$PackageDir = "",
  [switch]$OpenMetaBusinessSuite
)

$ErrorActionPreference = "Stop"

function Csv-Value {
  param($Value)
  $text = [string]$Value
  '"' + ($text -replace '"', '""') + '"'
}

function Find-LatestPackage {
  $root = Join-Path (Get-Location) "outputs\jazz-content-scheduler\manual-posting-packages"
  if (-not (Test-Path -LiteralPath $root)) {
    throw "No manual posting packages found yet."
  }
  $latest = Get-ChildItem -LiteralPath $root -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) {
    throw "No manual posting package folders found in $root"
  }
  return $latest.FullName
}

if ([string]::IsNullOrWhiteSpace($PackageDir)) {
  $PackageDir = Find-LatestPackage
}

if (-not (Test-Path -LiteralPath $PackageDir)) {
  throw "Package folder not found: $PackageDir"
}

$trackerPath = Join-Path $PackageDir "posting-tracker.csv"
if (-not (Test-Path -LiteralPath $trackerPath)) {
  throw "posting-tracker.csv not found in $PackageDir"
}

$rows = @(Import-Csv -LiteralPath $trackerPath -Encoding UTF8)
$next = $rows |
  Where-Object { ([string]$_.Status).ToLowerInvariant() -eq "pending" } |
  Sort-Object ScheduledFor |
  Select-Object -First 1

if (-not $next) {
  Write-Output "No pending posts remain in:"
  Write-Output $PackageDir
  return
}

$itemDir = Join-Path $PackageDir $next.Folder
if (-not (Test-Path -LiteralPath $itemDir)) {
  throw "Post folder not found: $itemDir"
}

$captionPath = Join-Path $itemDir "caption.txt"
$hashtagsPath = Join-Path $itemDir "hashtags.txt"
$videoPath = Join-Path $itemDir "reel.mp4"

$caption = if (Test-Path -LiteralPath $captionPath) { Get-Content -LiteralPath $captionPath -Raw } else { "" }
$hashtags = if (Test-Path -LiteralPath $hashtagsPath) { Get-Content -LiteralPath $hashtagsPath -Raw } else { "" }
$combined = ($caption.Trim(), $hashtags.Trim() | Where-Object { $_ }) -join "`r`n`r`n"
Set-Clipboard -Value $combined

Start-Process explorer.exe -ArgumentList "`"$itemDir`""

if ($OpenMetaBusinessSuite) {
  Start-Process "https://business.facebook.com/latest/content_calendar"
}

Write-Output "Next pending post:"
Write-Output "Title: $($next.Title)"
Write-Output "Scheduled: $($next.ScheduledFor)"
Write-Output "Folder: $itemDir"
Write-Output "Video: $videoPath"
Write-Output "Caption and hashtags copied to clipboard."
Write-Output ""
Write-Output "After posting/scheduling, update posting-tracker.csv Status from pending to posted."
