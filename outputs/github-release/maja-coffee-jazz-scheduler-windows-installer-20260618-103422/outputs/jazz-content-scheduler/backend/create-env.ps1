$ErrorActionPreference = "Stop"

$target = Join-Path $PSScriptRoot ".env"
$source = Join-Path $PSScriptRoot ".env.example"

if (Test-Path -LiteralPath $target) {
  Write-Output ".env already exists: $target"
  exit 0
}

Copy-Item -LiteralPath $source -Destination $target
Write-Output "Created .env from .env.example: $target"
Write-Output "Open it locally and fill META_APP_SECRET and META_ACCESS_TOKEN."
