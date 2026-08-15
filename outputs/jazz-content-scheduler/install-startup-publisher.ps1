param(
  [string]$TaskName = "Maja Coffee Jazz Daily Publisher",
  [int]$DelayMinutes = 2,
  [int]$IntervalMinutes = 180,
  [switch]$StartupOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublisherScript = Join-Path $ScriptDir "publish-due-once.ps1"
if (-not (Test-Path -LiteralPath $PublisherScript)) {
  throw "Publisher script not found: $PublisherScript"
}

function Remove-StartupFallback {
  $startupFolder = [Environment]::GetFolderPath("Startup")
  $cmdPath = Join-Path $startupFolder "Maja Coffee Jazz Daily Publisher.cmd"
  if (Test-Path -LiteralPath $cmdPath) {
    Remove-Item -LiteralPath $cmdPath -Force
    Write-Output "Removed older Startup folder fallback: $cmdPath"
  }
}

$ActionArgument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PublisherScript`""
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument $ActionArgument

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$logonTrigger.Delay = "PT$($DelayMinutes)M"

$triggers = @($logonTrigger)
if (-not $StartupOnly) {
  $repeatStart = (Get-Date).AddMinutes([Math]::Max(1, $DelayMinutes))
  $repeatTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At $repeatStart `
    -RepetitionInterval (New-TimeSpan -Minutes ([Math]::Max(5, $IntervalMinutes))) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  $triggers += $repeatTrigger
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description "Quietly checks and publishes due Maja's Coffee Jazz Zone posts, then exits." `
    -Force | Out-Null

  Remove-StartupFallback
  Write-Output "Installed startup publisher task: $TaskName"
  if ($StartupOnly) {
    Write-Output "It will run $DelayMinutes minute(s) after Windows login, publish due items from Posting Plan, then exit."
  } else {
    Write-Output "It will run $DelayMinutes minute(s) after Windows login, then every $IntervalMinutes minute(s) while you are signed in."
    Write-Output "Each check publishes due items from Posting Plan, writes a log, shows a notification, then exits."
  }
} catch {
  $registerError = $_.Exception.Message
  try {
    $taskCommand = "powershell.exe $ActionArgument"
    $scheduleMode = if ($StartupOnly) { "ONLOGON" } else { "MINUTE" }
    if ($StartupOnly) {
      $schtasksOutput = & schtasks.exe /Create /TN $TaskName /TR $taskCommand /SC ONLOGON /DELAY "000$($DelayMinutes):00" /F 2>&1
    } else {
      $schtasksOutput = & schtasks.exe /Create /TN $TaskName /TR $taskCommand /SC $scheduleMode /MO ([Math]::Max(5, $IntervalMinutes)) /F 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
      throw ($schtasksOutput -join "`n")
    }

    Remove-StartupFallback
    Write-Output "Scheduled Task cmdlet was blocked by Windows permissions: $registerError"
    Write-Output "Installed background publisher task with schtasks.exe: $TaskName"
    if ($StartupOnly) {
      Write-Output "It will run after Windows login, publish due items from Posting Plan, then exit."
    } else {
      Write-Output "It will check every $IntervalMinutes minute(s) while you are signed in, publish due items, then exit."
    }
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
    Write-Output "This fallback runs after Windows login only. For delayed 2-hour catch-up checks, install the Scheduled Task version from an unlocked Windows account."
  }
}
