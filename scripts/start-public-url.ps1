$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$UrlFile = Join-Path $ProjectRoot "REMOTE_URL.txt"
$ServerLog = Join-Path $ProjectRoot "remote-server.log"
$ServerErrLog = Join-Path $ProjectRoot "remote-server.err.log"
$TunnelLog = Join-Path $ProjectRoot "remote-tunnel.log"
$TunnelErrLog = Join-Path $ProjectRoot "remote-tunnel.err.log"
$Cloudflared = Join-Path $ProjectRoot "tools\cloudflared.exe"

Set-Location $ProjectRoot
Remove-Item -LiteralPath $UrlFile, $ServerLog, $ServerErrLog, $TunnelLog, $TunnelErrLog -Force -ErrorAction SilentlyContinue

Write-Host "Building the app..."
npm run build

Write-Host "Stopping old local server on port 8787 if needed..."
$owners = Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" -and $_.OwningProcess -ne 0 } |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pidToStop in $owners) {
  Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
}

Write-Host "Starting local app server at http://localhost:8787 ..."
$server = Start-Process -FilePath "node.exe" `
  -ArgumentList "server.mjs" `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $ServerLog `
  -RedirectStandardError $ServerErrLog `
  -PassThru

Start-Sleep -Seconds 3

Write-Host "Starting public HTTPS tunnel..."
if (Test-Path -LiteralPath $Cloudflared) {
  $tunnel = Start-Process -FilePath $Cloudflared `
    -ArgumentList "tunnel", "--url", "http://localhost:8787" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $TunnelLog `
    -RedirectStandardError $TunnelErrLog `
    -PassThru
  $urlPattern = "https://(?!api\.)[a-zA-Z0-9-]+\.trycloudflare\.com"
} else {
  $tunnel = Start-Process -FilePath "npx.cmd" `
    -ArgumentList "--yes", "localtunnel", "--port", "8787" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $TunnelLog `
    -RedirectStandardError $TunnelErrLog `
    -PassThru
  $urlPattern = "https://[^\s]+"
}

$deadline = (Get-Date).AddSeconds(45)
$publicUrl = $null
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Seconds 1
  if (Test-Path -LiteralPath $TunnelLog) {
    $text = Get-Content -LiteralPath $TunnelLog -Raw -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $TunnelErrLog) {
      $text += "`n" + (Get-Content -LiteralPath $TunnelErrLog -Raw -ErrorAction SilentlyContinue)
    }
    $match = [regex]::Match($text, $urlPattern)
    if ($match.Success) {
      $publicUrl = $match.Value.Trim()
    }
  }
}

if (-not $publicUrl) {
  Write-Host "Could not read the public URL yet. Check remote-tunnel.log."
  Write-Host "Local app is running at http://localhost:8787"
  Write-Host "Server PID: $($server.Id), tunnel PID: $($tunnel.Id)"
  exit 1
}

Set-Content -LiteralPath $UrlFile -Value $publicUrl -Encoding UTF8
Write-Host ""
Write-Host "Public URL:"
Write-Host $publicUrl
Write-Host ""
Write-Host "The phone only needs to open this HTTPS URL. Keep this computer awake while using it."
Write-Host "Server PID: $($server.Id), tunnel PID: $($tunnel.Id)"
