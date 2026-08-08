# Koto static file server — stable for large dict/*.gz
$ErrorActionPreference = "Continue"
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$root = [IO.Path]::GetFullPath($root)
$port = 8765
$prefix = "http://127.0.0.1:$port/"
$logFile = Join-Path $root "serve.log"

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  Write-Host $line
}

try {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500
} catch {}

$listener = New-Object System.Net.HttpListener
# Allow reuse
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Log "ERROR bind $prefix : $_"
  exit 1
}

Log "Serving $root"
Log "URL $prefix"

function Get-ContentType([string]$path) {
  $p = $path.ToLowerInvariant()
  if ($p.EndsWith(".html") -or $p.EndsWith(".htm")) { return "text/html; charset=utf-8" }
  if ($p.EndsWith(".js")) { return "application/javascript; charset=utf-8" }
  if ($p.EndsWith(".css")) { return "text/css; charset=utf-8" }
  if ($p.EndsWith(".json")) { return "application/json; charset=utf-8" }
  if ($p.EndsWith(".svg")) { return "image/svg+xml" }
  if ($p.EndsWith(".png")) { return "image/png" }
  if ($p.EndsWith(".jpg") -or $p.EndsWith(".jpeg")) { return "image/jpeg" }
  if ($p.EndsWith(".gz")) { return "application/octet-stream" }
  return "application/octet-stream"
}

while ($true) {
  $ctx = $null
  try {
    $ctx = $listener.GetContext()
  } catch {
    Log "GetContext failed: $_"
    break
  }

  $req = $ctx.Request
  $res = $ctx.Response
  $rel = ""
  try {
    $rel = [Uri]::UnescapeDataString($req.Url.LocalPath).TrimStart([char[]]@('/','\'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
    $rel = $rel.Replace('/', [IO.Path]::DirectorySeparatorChar).Replace('\', [IO.Path]::DirectorySeparatorChar)

    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $rel))
    $rootPrefix = $root.TrimEnd([char[]]@('\','/')) + [IO.Path]::DirectorySeparatorChar
    if (-not ($full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
              $full.Equals($root.TrimEnd([char[]]@('\','/')), [StringComparison]::OrdinalIgnoreCase))) {
      $res.StatusCode = 403
      $res.Close()
      Log "403 $rel"
      continue
    }

    if (-not [IO.File]::Exists($full)) {
      $res.StatusCode = 404
      $buf = [Text.Encoding]::UTF8.GetBytes("404 $rel")
      $res.ContentType = "text/plain; charset=utf-8"
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
      $res.Close()
      Log "404 $rel"
      continue
    }

    $info = [IO.FileInfo]::new($full)
    $res.StatusCode = 200
    $res.ContentType = Get-ContentType $full
    $res.ContentLength64 = $info.Length
    $res.SendChunked = $false
    try { $res.Headers["Access-Control-Allow-Origin"] = "*" } catch {}
    try { $res.Headers["Cache-Control"] = "public, max-age=120" } catch {}

    # Stream file in chunks (stable for multi-MB dict)
    $fs = [IO.File]::OpenRead($full)
    try {
      $buffer = New-Object byte[] (256 * 1024)
      while (($read = $fs.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $res.OutputStream.Write($buffer, 0, $read)
      }
      $res.OutputStream.Flush()
    } finally {
      $fs.Dispose()
    }
    $res.Close()
    Log "200 $rel ($($info.Length))"
  } catch {
    Log "ERR $rel : $($_.Exception.Message)"
    try {
      if ($res -and -not $res.OutputStream.CanWrite) { }
      else {
        $res.StatusCode = 500
        $res.Close()
      }
    } catch {}
  }
}

try { $listener.Stop() } catch {}
try { $listener.Close() } catch {}
Log "Stopped"
