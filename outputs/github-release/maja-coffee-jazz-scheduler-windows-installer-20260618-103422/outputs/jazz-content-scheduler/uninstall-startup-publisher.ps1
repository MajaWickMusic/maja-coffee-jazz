param(
  [string]$TaskName = "Maja Coffee Jazz Daily Publisher"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed startup publisher task: $TaskName"
} else {
  Write-Output "Startup publisher task was not installed: $TaskName"
}

$startupFolder = [Environment]::GetFolderPath("Startup")
$cmdPath = Join-Path $startupFolder "Maja Coffee Jazz Daily Publisher.cmd"
if (Test-Path -LiteralPath $cmdPath) {
  Remove-Item -LiteralPath $cmdPath -Force
  Write-Output "Removed Startup folder publisher: $cmdPath"
}
