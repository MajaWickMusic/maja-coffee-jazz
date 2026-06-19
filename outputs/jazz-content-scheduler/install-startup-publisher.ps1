param(
  [string]$TaskName = "Maja Coffee Jazz Daily Publisher",
  [int]$DelayMinutes = 2
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublisherScript = Join-Path $ScriptDir "publish-due-once.ps1"
if (-not (Test-Path -LiteralPath $PublisherScript)) {
  throw "Publisher script not found: $PublisherScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PublisherScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = "PT$($DelayMinutes)M"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Publishes due Maja's Coffee Jazz Zone posts once when Windows starts." `
    -Force | Out-Null

  Write-Output "Installed startup publisher task: $TaskName"
  Write-Output "It will run $DelayMinutes minute(s) after Windows login, publish due items from Posting Plan, then exit."
} catch {
  $startupFolder = [Environment]::GetFolderPath("Startup")
  $cmdPath = Join-Path $startupFolder "Maja Coffee Jazz Daily Publisher.cmd"
  $delaySeconds = [Math]::Max(0, $DelayMinutes * 60)
  $cmd = @(
    "@echo off",
    "timeout /t $delaySeconds /nobreak >nul",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PublisherScript`""
  ) -join "`r`n"

  Set-Content -LiteralPath $cmdPath -Value $cmd -Encoding ASCII

  Write-Output "Scheduled Task install was blocked by Windows permissions."
  Write-Output "Installed Startup folder publisher instead: $cmdPath"
  Write-Output "It will run $DelayMinutes minute(s) after Windows login, publish due items from Posting Plan, then exit."
}
