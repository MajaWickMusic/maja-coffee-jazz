$ErrorActionPreference = "Stop"

$startupFolder = [Environment]::GetFolderPath("Startup")
$cmdPath = Join-Path $startupFolder "Maja Coffee Jazz Dashboard.cmd"

if (Test-Path -LiteralPath $cmdPath) {
  Remove-Item -LiteralPath $cmdPath -Force
  Write-Output "Removed startup dashboard shortcut: $cmdPath"
} else {
  Write-Output "Startup dashboard shortcut was not installed."
}
