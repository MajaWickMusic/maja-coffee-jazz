param(
  [string]$PackageJson = "$env:USERPROFILE\Downloads\posting-package-uploaded.json",
  [string]$OutJson = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$backendDir = Join-Path $scriptDir "backend"
$worker = Join-Path $backendDir "create-instagram-containers.mjs"

$nodeCandidates = @(
  "C:\Users\willi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  "node"
)

$node = $null
foreach ($candidate in $nodeCandidates) {
  try {
    $cmd = Get-Command $candidate -ErrorAction Stop
    $node = $cmd.Source
    break
  } catch {}
}

if (-not $node) {
  throw "Node.js was not found."
}

if (-not $OutJson) {
  $outDir = Join-Path $scriptDir "instagram-container-runs"
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
  $OutJson = Join-Path $outDir "posting-package-uploaded-containers-$stamp.json"
}

$argsList = @(
  $worker,
  "--package", $PackageJson,
  "--out", $OutJson
)

if ($DryRun) {
  $argsList += "--dry-run"
}

Push-Location $workspaceRoot
try {
  & $node @argsList
} finally {
  Pop-Location
}
