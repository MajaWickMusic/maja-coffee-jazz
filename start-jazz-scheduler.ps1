$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendScript = Join-Path $rootDir "outputs\jazz-content-scheduler\backend\start-backend.ps1"
$dashboardScript = Join-Path $rootDir "outputs\jazz-content-scheduler\open-dashboard.ps1"
$healthUrl = "http://127.0.0.1:8787/health"

function Test-BackendReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-BackendReady)) {
  Start-Process powershell -ArgumentList @(
    "-ExecutionPolicy", "Bypass",
    "-NoExit",
    "-File", $backendScript
  ) -WindowStyle Normal

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

& powershell -ExecutionPolicy Bypass -NoProfile -File $dashboardScript
