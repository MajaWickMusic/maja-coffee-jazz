param(
  [int]$ParentPid = 0
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$nodeCandidates = @(
  $env:RELEASEPILOT_NODE,
  $env:JAZZ_SCHEDULER_NODE,
  "node",
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
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
  throw "Node.js was not found. Install Node.js from https://nodejs.org, then reopen ReleasePilot."
}

Push-Location $scriptDir
try {
  $args = @(".\server.mjs")
  if ($ParentPid -gt 0) {
    $args += @("--parent-pid", $ParentPid)
  }
  & $node @args
} finally {
  Pop-Location
}
