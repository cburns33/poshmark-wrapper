param([switch]$Collect, [switch]$Test)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$bundledNode = Join-Path $runtimeRoot 'node\bin\node.exe'
if ($nodeCommand) { $nodePath = $nodeCommand.Source }
elseif (Test-Path -LiteralPath $bundledNode) {
  $nodePath = $bundledNode
  $env:NODE_PATH = Join-Path $runtimeRoot 'node\node_modules'
} else { throw 'Node.js 24 or newer is required.' }
Push-Location $PSScriptRoot
try {
  if ($Collect) { & $nodePath 'collect.cjs' }
  elseif ($Test) { & $nodePath '--test' 'test\core.test.cjs' }
  else { & $nodePath 'server.cjs' }
} finally { Pop-Location }
