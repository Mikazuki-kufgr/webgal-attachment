param(
  [ValidateSet("Install", "Validate", "Repair", "Uninstall", "Recover")]
  [string]$Mode = "Install",
  [string]$Request = "",
  [switch]$HumanReadable
)
$ErrorActionPreference = "Stop"
$productRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = Join-Path $productRoot "runtime\node\node.exe"
$lifecycle = Join-Path $productRoot "runtime\install-lifecycle.mjs"
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw "BUNDLED_NODE_NOT_FOUND" }
if (-not (Test-Path -LiteralPath $lifecycle -PathType Leaf)) { throw "LIFECYCLE_NOT_FOUND" }
$arguments = @($lifecycle, "--mode", $Mode)
if ($Request) { $arguments += @("--request", $Request) }
if ($HumanReadable) { $arguments += "--human" }
$runnerNode = $nodeExe
$temporaryNode = $null
try {
  if ($Mode -in @("Install", "Repair", "Uninstall") -and (Test-Path -LiteralPath (Join-Path $productRoot "config\installed-files.json") -PathType Leaf)) {
    # Reject running host processes before even creating the temporary executable.
    $preflightArguments = $arguments + @("--preflight-only")
    & $nodeExe @preflightArguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $hostRoot = Split-Path -Parent $productRoot
    Set-Location -LiteralPath $hostRoot
    [Environment]::CurrentDirectory = $hostRoot
    $temporaryNode = Join-Path $hostRoot (".webgal-attachment.uninstall-node-" + [Guid]::NewGuid().ToString("N") + ".exe")
    Copy-Item -LiteralPath $nodeExe -Destination $temporaryNode
    $runnerNode = $temporaryNode
  }
  & $runnerNode @arguments
  $exitCode = $LASTEXITCODE
} finally {
  if ($temporaryNode -and (Test-Path -LiteralPath $temporaryNode -PathType Leaf)) {
    Remove-Item -LiteralPath $temporaryNode -Force
  }
}
exit $exitCode
