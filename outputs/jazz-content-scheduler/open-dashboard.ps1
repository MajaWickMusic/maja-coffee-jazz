$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dashboardPath = Join-Path $scriptDir "index.html"
$dashboardUrl = ([System.Uri]::new($dashboardPath).AbsoluteUri) + "?v=" + (Get-Date -Format "yyyyMMddHHmmss") + "#dashboard"

$browserCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)

$browser = $browserCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($browser) {
  $profileDir = Join-Path $env:LOCALAPPDATA "MajaCoffeeJazzScheduler\BrowserProfile"
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  Start-Process -FilePath $browser -ArgumentList @(
    "--app=$dashboardUrl",
    "--disable-cache",
    "--user-data-dir=$profileDir"
  )
} else {
  Write-Host "Could not find Edge or Chrome automatically."
  Write-Host "Open this URL manually in your browser:"
  Write-Host $dashboardUrl
}
