$ErrorActionPreference = "Continue"
$serve = Join-Path $PSScriptRoot "serve.ps1"
$log = Join-Path $PSScriptRoot "serve-wrapper.log"
function WLog($m){ Add-Content -LiteralPath $log -Value ("[{0}] {1}" -f (Get-Date -Format o), $m) -Encoding UTF8 }

WLog "Wrapper start"
while ($true) {
  WLog "Launching serve.ps1"
  $p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$serve) -PassThru -WindowStyle Hidden
  WLog "serve PID=$($p.Id)"
  # Wait until process exits
  Wait-Process -Id $p.Id -ErrorAction SilentlyContinue
  WLog "serve exited code=$($p.ExitCode) — restart in 1s"
  Start-Sleep -Seconds 1
}
