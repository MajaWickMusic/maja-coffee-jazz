param(
  [int]$DelaySeconds = 20
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$StarterScript = Join-Path $WorkspaceRoot "start-jazz-scheduler.ps1"
if (-not (Test-Path -LiteralPath $StarterScript)) {
  throw "Dashboard starter script not found: $StarterScript"
}

$startupFolder = [Environment]::GetFolderPath("Startup")
$cmdPath = Join-Path $startupFolder "ReleasePilot Dashboard.cmd"
$delay = [Math]::Max(0, $DelaySeconds)
$cmd = @(
  "@echo off",
  "timeout /t $delay /nobreak >nul",
  "cd /d `"$WorkspaceRoot`"",
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$StarterScript`""
) -join "`r`n"

Set-Content -LiteralPath $cmdPath -Value $cmd -Encoding ASCII

Write-Output "Installed startup dashboard shortcut: $cmdPath"
Write-Output "It will open the ReleasePilot dashboard $DelaySeconds second(s) after Windows login."
