param(
  [string]$PackageJson = "$env:USERPROFILE\Downloads\posting-package.json",
  [string]$OutJson = "",
  [switch]$DryRun,
  [switch]$FromClipboard
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$backendDir = Join-Path $scriptDir "backend"
$uploader = Join-Path $backendDir "upload-r2-reels.mjs"

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
  $OutJson = $PackageJson -replace '\.json$', '-uploaded.json'
}

$argsList = @(
  $uploader,
  "--out", $OutJson
)

if ($FromClipboard) {
  $argsList += "--from-clipboard"
} else {
  $argsList += @("--package", $PackageJson)
}

if ($DryRun) {
  $argsList += "--dry-run"
}

Push-Location $workspaceRoot
try {
  & $node @argsList
} finally {
  Pop-Location
}
