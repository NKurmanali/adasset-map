$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
node scripts/setup.mjs
if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) { npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed' } }
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$pidPath = Join-Path $PSScriptRoot '.local\server.pid'
$running = $false
if (Test-Path -LiteralPath $pidPath) { $serverPid = [int](Get-Content -LiteralPath $pidPath); $running = $null -ne (Get-Process -Id $serverPid -ErrorAction SilentlyContinue) }
if (-not $running) {
 $node = (Get-Command node.exe).Source
 $nextPath = Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'
 $process = Start-Process -FilePath $node -ArgumentList @(('"' + $nextPath + '"'),'start','--hostname','127.0.0.1','--port','3000') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput '.local\server.out.log' -RedirectStandardError '.local\server.err.log' -PassThru
 Set-Content -LiteralPath $pidPath -Value $process.Id
}
Write-Output 'AdAsset Map: http://127.0.0.1:3000'
Write-Output 'Local credentials: .local-access.txt'
Start-Process 'http://127.0.0.1:3000'
