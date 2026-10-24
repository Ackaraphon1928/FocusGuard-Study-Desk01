[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8000,
    [ValidateSet('demo', 'hardware')]
    [string]$Mode = 'demo',
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Host 'Creating the local Python environment...'
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer is required.' }
    $Install = $true
}
if ($Install) {
    & $pythonPath -m pip install -r backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the output above.' }
}
& $pythonPath -c "import fastapi, uvicorn"
if ($LASTEXITCODE -ne 0) { throw 'Dependencies are missing. Run .\start.ps1 -Install.' }
$env:FOCUSGUARD_MODE = $Mode
Write-Host "FocusGuard: http://127.0.0.1:$Port ($Mode mode)"
Write-Host 'Press Ctrl+C to stop. Sensor metadata and sessions are stored locally.'
& $pythonPath -m uvicorn backend.main:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
