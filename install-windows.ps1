param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$SourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\MajaCoffeeJazzScheduler"
}

function Copy-ReleaseFile {
  param(
    [string]$RelativePath
  )

  $source = Join-Path $SourceRoot $RelativePath
  $destination = Join-Path $InstallDir $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    return
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

function New-Shortcut {
  param(
    [string]$Path,
    [string]$TargetPath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$Description
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
  $shortcut.Save()
}

$files = @(
  "README.md",
  "START-HERE.md",
  "start-jazz-scheduler.bat",
  "start-jazz-scheduler.ps1",
  "outputs\jazz-content-scheduler\app.js",
  "outputs\jazz-content-scheduler\index.html",
  "outputs\jazz-content-scheduler\styles.css",
  "outputs\jazz-content-scheduler\README.md",
  "outputs\jazz-content-scheduler\create-instagram-containers.ps1",
  "outputs\jazz-content-scheduler\install-startup-dashboard.ps1",
  "outputs\jazz-content-scheduler\install-startup-publisher.ps1",
  "outputs\jazz-content-scheduler\open-dashboard.ps1",
  "outputs\jazz-content-scheduler\open-next-manual-post.ps1",
  "outputs\jazz-content-scheduler\package-manual-posting.ps1",
  "outputs\jazz-content-scheduler\publish-due-once.ps1",
  "outputs\jazz-content-scheduler\render-next-draft-reels.ps1",
  "outputs\jazz-content-scheduler\uninstall-startup-dashboard.ps1",
  "outputs\jazz-content-scheduler\uninstall-startup-publisher.ps1",
  "outputs\jazz-content-scheduler\upload-reels-to-r2.ps1",
  "outputs\jazz-content-scheduler\backend\.env.example",
  "outputs\jazz-content-scheduler\backend\.gitignore",
  "outputs\jazz-content-scheduler\backend\create-env.ps1",
  "outputs\jazz-content-scheduler\backend\create-instagram-containers.mjs",
  "outputs\jazz-content-scheduler\backend\README.md",
  "outputs\jazz-content-scheduler\backend\server.mjs",
  "outputs\jazz-content-scheduler\backend\start-backend.ps1",
  "outputs\jazz-content-scheduler\backend\upload-r2-reels.mjs",
  "work\build-catalog-file-map.ps1",
  "work\render-reel-batch.ps1"
)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
foreach ($file in $files) {
  Copy-ReleaseFile -RelativePath $file
}

$directories = @(
  "outputs\jazz-content-scheduler\backend\config",
  "outputs\jazz-content-scheduler\api-runs",
  "outputs\jazz-content-scheduler\rendered-reels"
)
foreach ($directory in $directories) {
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir $directory) | Out-Null
}

$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Maja Coffee Jazz Scheduler"
$desktopDir = [Environment]::GetFolderPath("Desktop")
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

$launcher = Join-Path $InstallDir "start-jazz-scheduler.bat"
$uninstaller = Join-Path $InstallDir "uninstall-windows.ps1"
Copy-Item -LiteralPath (Join-Path $SourceRoot "uninstall-windows.ps1") -Destination $uninstaller -Force

New-Shortcut `
  -Path (Join-Path $startMenuDir "Jazz Scheduler.lnk") `
  -TargetPath $launcher `
  -Arguments "" `
  -WorkingDirectory $InstallDir `
  -Description "Open Jazz Content Scheduler"

New-Shortcut `
  -Path (Join-Path $desktopDir "Jazz Scheduler.lnk") `
  -TargetPath $launcher `
  -Arguments "" `
  -WorkingDirectory $InstallDir `
  -Description "Open Jazz Content Scheduler"

New-Shortcut `
  -Path (Join-Path $startMenuDir "Uninstall Jazz Scheduler.lnk") `
  -TargetPath "powershell.exe" `
  -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"" `
  -WorkingDirectory $InstallDir `
  -Description "Uninstall Jazz Content Scheduler"

Write-Output "Jazz Scheduler installed."
Write-Output "Install folder: $InstallDir"
Write-Output "Desktop shortcut: Jazz Scheduler"
Write-Output "Start Menu folder: Maja Coffee Jazz Scheduler"
