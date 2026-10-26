param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath 'node_modules')) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
node scripts/setup.mjs
if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) { npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed' } }
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
$pidPath = Join-Path $PSScriptRoot '.local\server.pid'
$running = $false
if (Test-Path -LiteralPath $pidPath) {
 $serverPid = [int](Get-Content -LiteralPath $pidPath)
 $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
 $expectedNext = Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'
 $running = $existing -and $existing.Name -eq 'node.exe' -and $existing.CommandLine.Contains($expectedNext)
}
if (-not $running) {
 $node = (Get-Command node.exe).Source
 $nextPath = Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'
 $process = Start-Process -FilePath $node -ArgumentList @(('"' + $nextPath + '"'),'start','--hostname','127.0.0.1','--port','3000') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput '.local\server.out.log' -RedirectStandardError '.local\server.err.log' -PassThru
 Set-Content -LiteralPath $pidPath -Value $process.Id
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
 try {
  $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 1
  if ($response.StatusCode -eq 200 -and $response.Content.Contains('AdAsset Map')) { $ready = $true; break }
 } catch {}
 Start-Sleep -Milliseconds 300
}
if (-not $ready) { throw 'AdAsset Map did not start. See .local/server.err.log.' }
Write-Output 'AdAsset Map: http://127.0.0.1:3000'
Write-Output 'Local credentials: .local-access.txt'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3000' }
