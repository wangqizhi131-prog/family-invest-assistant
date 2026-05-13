$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host "Building and starting Family Invest Assistant on http://localhost:8787 ..."
npm run build

$server = Start-Process -FilePath "node.exe" -ArgumentList "server.mjs" -WorkingDirectory $ProjectRoot -PassThru
Start-Sleep -Seconds 2

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "cloudflared is not installed."
  Write-Host "Install it with:"
  Write-Host "  winget install --id Cloudflare.cloudflared"
  Write-Host ""
  Write-Host "After installation, rerun this script."
  Write-Host "Local app is still running at http://localhost:8787"
  Wait-Process -Id $server.Id
  exit
}

Write-Host "Starting Cloudflare temporary tunnel. Copy the https://*.trycloudflare.com URL for remote access."
cloudflared tunnel --url http://localhost:8787
