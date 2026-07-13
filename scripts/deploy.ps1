<#
.SYNOPSIS
    Deploys the ha_tracker custom integration to a Home Assistant "config" folder.

.DESCRIPTION
    Mirrors custom_components/ha_tracker into <HA config>/custom_components/ha_tracker
    using robocopy. Does NOT run the JS build itself — use "npm run deploy" (which builds
    first) or run "npm run build" beforehand.

    The destination is resolved in this order:
      1. -HaConfig parameter
      2. $env:HA_CONFIG environment variable

    Point it at the HA *config* directory (the one containing configuration.yaml), e.g.:
      - Samba share:  \\192.168.1.111\config
      - Mapped drive: Z:\
      - Local path:   C:\ha\config

.EXAMPLE
    powershell -File scripts/deploy.ps1 -HaConfig \\192.168.1.111\config

.EXAMPLE
    $env:HA_CONFIG = '\\192.168.1.111\config'; npm run deploy
#>
[CmdletBinding()]
param(
    [string]$HaConfig = $env:HA_CONFIG
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($HaConfig)) {
    Write-Error "No Home Assistant config path given. Pass -HaConfig '\\192.168.1.111\config' or set the HA_CONFIG environment variable."
    exit 1
}

# Repo root = parent of this script's folder
$repoRoot = Split-Path -Parent $PSScriptRoot
$source   = Join-Path $repoRoot 'custom_components\ha_tracker'
$dest     = Join-Path $HaConfig 'custom_components\ha_tracker'

if (-not (Test-Path $source)) {
    Write-Error "Source not found: $source"
    exit 1
}
if (-not (Test-Path $HaConfig)) {
    Write-Error "HA config path not reachable: $HaConfig (is the share mounted / HA online?)"
    exit 1
}

Write-Host "Deploying:" -ForegroundColor Cyan
Write-Host "  from : $source"
Write-Host "  to   : $dest"

# /MIR mirrors (deletes files in dest that no longer exist in source).
# We do NOT exclude __pycache__: the dev tree has none, and letting /MIR run means any
# stale bytecode left on the target from a previous run gets purged. Excluding it (via
# /XD) would leave old .pyc behind, which can mask Python changes until HA recompiles.
$roboArgs = @(
    $source, $dest,
    '/MIR',
    '/NFL', '/NDL', '/NP', '/R:2', '/W:2'
)

& robocopy @roboArgs
$code = $LASTEXITCODE

# robocopy exit codes 0-7 are success (8+ are errors). PowerShell treats non-zero as failure,
# so normalize here.
if ($code -ge 8) {
    Write-Error "robocopy failed with exit code $code"
    exit $code
}

# Belt-and-suspenders: physically remove any bytecode caches on the target so HA can
# never load stale .pyc after a Python change.
Get-ChildItem -Path $dest -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Deploy complete (robocopy code $code)." -ForegroundColor Green
Write-Host "IMPORTANT: a Python change (api/, config_flow.py, __init__.py) needs a FULL" -ForegroundColor Yellow
Write-Host "Home Assistant RESTART - a reload or remove/re-add will NOT reload the code." -ForegroundColor Yellow
Write-Host "Then hard-refresh the browser (Ctrl+F5)." -ForegroundColor Yellow
exit 0
