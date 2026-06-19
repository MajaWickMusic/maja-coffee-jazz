param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Maja Coffee Jazz Scheduler"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Jazz Scheduler.lnk"

if (Test-Path -LiteralPath $desktopShortcut) {
  Remove-Item -LiteralPath $desktopShortcut -Force
}

if (Test-Path -LiteralPath $startMenuDir) {
  Remove-Item -LiteralPath $startMenuDir -Recurse -Force
}

$startupPublisher = Join-Path ([Environment]::GetFolderPath("Startup")) "Maja Coffee Jazz Daily Publisher.cmd"
$startupDashboard = Join-Path ([Environment]::GetFolderPath("Startup")) "Maja Coffee Jazz Dashboard.cmd"
foreach ($shortcut in @($startupPublisher, $startupDashboard)) {
  if (Test-Path -LiteralPath $shortcut) {
    Remove-Item -LiteralPath $shortcut -Force
  }
}

if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

Write-Output "Jazz Scheduler has been removed."
