[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8000,
    [ValidateSet('demo', 'hardware')]
    [string]$Mode = 'demo',
    [switch]$Install,
    [switch]$Build
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

$frontendPath = Join-Path $PSScriptRoot 'frontend'
$builtIndex = Join-Path $frontendPath 'dist\index.html'
$needsBuild = $Build -or $Install -or -not (Test-Path -LiteralPath $builtIndex)
if (-not $needsBuild) {
    $builtAt = (Get-Item -LiteralPath $builtIndex).LastWriteTimeUtc
    $sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $frontendPath 'src') -Recurse -File)
    $sourceFiles += Get-ChildItem -LiteralPath $frontendPath -File | Where-Object {
        $_.Name -eq 'index.html' -or $_.Extension -in '.json', '.ts', '.js'
    }
    $needsBuild = [bool]($sourceFiles | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1)
}
if ($needsBuild) {
    $portableNode = Join-Path $PSScriptRoot '.tools\node-v24.22.1-win-x64\node.exe'
    $nodePath = if (Test-Path -LiteralPath $portableNode) { $portableNode } else {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if ($nodeCommand) { $nodeCommand.Source }
    }
    if (-not $nodePath) { throw 'Install Node.js 24 LTS (24.15 or newer), then run .\start.ps1 -Install. See frontend/README.md.' }
    & $nodePath -e 'const [major, minor] = process.versions.node.split(/[.]/).map(Number); if (major !== 24 || minor < 15) process.exit(1)'
    if ($LASTEXITCODE -ne 0) { throw 'The frontend requires Node.js 24 LTS, version 24.15 or newer.' }
    $nodeDirectory = Split-Path -Parent $nodePath
    $npmPath = Join-Path $nodeDirectory 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npmPath)) { throw 'npm.cmd was not found beside Node.js. Reinstall Node.js 24 LTS with npm.' }
    $env:Path = "$nodeDirectory;$env:Path"
    Push-Location -LiteralPath $frontendPath
    try {
        if ($Install -or -not (Test-Path -LiteralPath 'node_modules')) {
            Write-Host 'Installing locked frontend dependencies...'
            & $npmPath ci --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        }
        Write-Host 'Building the React / TypeScript / Tailwind dashboard...'
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed. Check the output above.' }
    }
    finally { Pop-Location }
}
$env:FOCUSGUARD_MODE = $Mode
Write-Host "FocusGuard: http://127.0.0.1:$Port ($Mode mode)"
Write-Host 'Press Ctrl+C to stop. Sensor metadata and sessions are stored locally.'
& $pythonPath -m uvicorn backend.main:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
