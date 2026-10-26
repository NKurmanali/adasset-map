$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot '.local\server.pid'
if (Test-Path -LiteralPath $pidPath) {
 $serverPid = [int](Get-Content -LiteralPath $pidPath)
 $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
 $nextPath = Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'
 if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.Contains($nextPath)) { Stop-Process -Id $serverPid }
 Remove-Item -LiteralPath $pidPath
 Write-Output 'AdAsset Map stopped.'
}
