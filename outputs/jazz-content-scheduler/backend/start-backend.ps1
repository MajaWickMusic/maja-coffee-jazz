$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

Push-Location $scriptDir
try {
  & $node ".\server.mjs"
} finally {
  Pop-Location
}
