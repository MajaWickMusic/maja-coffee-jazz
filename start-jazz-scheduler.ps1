$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendScript = Join-Path $rootDir "outputs\jazz-content-scheduler\backend\start-backend.ps1"
$dashboardScript = Join-Path $rootDir "outputs\jazz-content-scheduler\open-dashboard.ps1"
$healthUrl = "http://127.0.0.1:8787/health"
$shutdownUrl = "http://127.0.0.1:8787/api/shutdown"

$backendProcess = $null
$startedBackend = $false

function Test-BackendReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Stop-Backend {
  if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
    try {
      Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    } catch {}
    return
  }

  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri $shutdownUrl -TimeoutSec 2 | Out-Null
  } catch {}
}

try {
  if (-not (Test-BackendReady)) {
    $backendProcess = Start-Process powershell -ArgumentList @(
      "-ExecutionPolicy", "Bypass",
      "-File", $backendScript,
      "-ParentPid", $PID
    ) -WindowStyle Normal -PassThru
    $startedBackend = $true

    $ready = $false
    for ($i = 0; $i -lt 30; $i += 1) {
      Start-Sleep -Seconds 1
      if (Test-BackendReady) {
        $ready = $true
        break
      }
    }

    if (-not $ready) {
      Write-Host "The dashboard will open, but the backend did not answer yet."
      Write-Host "Check the backend PowerShell window for an error."
      Start-Sleep -Seconds 4
    }
  }

  $dashboardPid = (& powershell -ExecutionPolicy Bypass -NoProfile -File $dashboardScript -PassThru | Select-Object -Last 1)
  $dashboardUrl = ([System.Uri]::new((Join-Path (Split-Path -Parent $dashboardScript) "index.html")).AbsoluteUri) + "?v=" + (Get-Date -Format "yyyyMMddHHmmss") + "#dashboard"

  Write-Host ""
  Write-Host "ReleasePilot is running."
  Write-Host "Dashboard: $dashboardUrl"
  Write-Host "Close this launcher window when you want to stop the local backend."

  while ($true) {
    Start-Sleep -Seconds 2

    if ($backendProcess) {
      $backendProcess.Refresh()
      if ($backendProcess.HasExited) {
        Write-Host "The backend window closed. Reopen ReleasePilot.exe to start again."
        Start-Sleep -Seconds 4
        break
      }
    }
  }
} catch {
  Write-Host ""
  Write-Host "ReleasePilot could not start:"
  Write-Host $_.Exception.Message
  Write-Host ""
  Read-Host "Press Enter to close this window"
} finally {
  Stop-Backend
}
