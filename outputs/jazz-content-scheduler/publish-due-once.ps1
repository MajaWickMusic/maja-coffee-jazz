param(
  [string]$NodePath = "",
  [string]$LogDir = "",
  [switch]$NoNotifications
)

$ErrorActionPreference = "Stop"

function Show-PublisherNotification {
  param(
    [string]$Title,
    [string]$Message,
    [string]$Icon = "Info"
  )

  if ($NoNotifications) {
    return
  }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::$Icon
    $notify.BalloonTipTitle = $Title
    $notify.BalloonTipText = $Message
    $notify.Text = "Maja Coffee Jazz Publisher"
    $notify.Visible = $true
    $notify.ShowBalloonTip(7000)
    Start-Sleep -Seconds 8
    $notify.Visible = $false
    $notify.Dispose()
  } catch {
    # Notifications are helpful but should never stop publishing.
  }
}

function Get-PublishSummary {
  param(
    [string[]]$OutputLines,
    [int]$ExitCode
  )

  $raw = ($OutputLines -join "`n").Trim()
  if (-not $raw) {
    if ($ExitCode -eq 0) {
      return @{
        Title = "Jazz publisher finished"
        Message = "The startup publisher ran, but did not return a detailed result."
        Icon = "Info"
      }
    }
    return @{
      Title = "Jazz publisher needs attention"
      Message = "The startup publisher stopped with exit code $ExitCode."
      Icon = "Error"
    }
  }

  try {
    $result = $raw | ConvertFrom-Json
    $published = 0
    $errors = 0
    $message = "Startup publish check finished."
    if ($null -ne $result.publishedCount) {
      $published = [int]$result.publishedCount
    }
    if ($null -ne $result.errorCount) {
      $errors = [int]$result.errorCount
    }
    if ($result.message) {
      $message = [string]$result.message
    }

    if ($errors -gt 0 -or -not $result.ok) {
      return @{
        Title = "Jazz publisher needs attention"
        Message = $message
        Icon = "Error"
      }
    }

    if ($published -gt 0) {
      return @{
        Title = "Jazz content posted"
        Message = $message
        Icon = "Info"
      }
    }

    return @{
      Title = "Jazz publisher checked"
      Message = $message
      Icon = "Info"
    }
  } catch {
    if ($ExitCode -eq 0) {
      return @{
        Title = "Jazz publisher finished"
        Message = "The startup publisher finished. Open the app to review the latest log."
        Icon = "Info"
      }
    }
    return @{
      Title = "Jazz publisher needs attention"
      Message = ($raw -replace "\s+", " ").Substring(0, [Math]::Min(220, ($raw -replace "\s+", " ").Length))
      Icon = "Error"
    }
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPath = Join-Path $ScriptDir "backend\server.mjs"
if (-not $LogDir) {
  $LogDir = Join-Path $ScriptDir "api-runs"
}
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

if (-not $NodePath) {
  $BundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path -LiteralPath $BundledNode) {
    $NodePath = $BundledNode
  } else {
    $NodePath = "node"
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $LogDir "startup-publisher-$stamp.log"

"[$(Get-Date -Format o)] Starting one-shot publisher..." | Tee-Object -FilePath $logPath
Show-PublisherNotification `
  -Title "Jazz publisher starting" `
  -Message "Checking today's approved Meta, Instagram, Shorts, and YouTube videos now." `
  -Icon "Info"

$output = & $NodePath $BackendPath --publish-due-once 2>&1
$output | Tee-Object -FilePath $logPath -Append
$exit = $LASTEXITCODE
"[$(Get-Date -Format o)] Finished with exit code $exit." | Tee-Object -FilePath $logPath -Append

$summary = Get-PublishSummary -OutputLines $output -ExitCode $exit
Show-PublisherNotification `
  -Title $summary.Title `
  -Message $summary.Message `
  -Icon $summary.Icon

exit $exit
