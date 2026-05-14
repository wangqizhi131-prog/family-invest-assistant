param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [string]$ServiceId = "srv-d82hdojrjlhs73dh2i8g",
  [string]$RenderConfig = "$env:USERPROFILE\.render\cli.yaml"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $RenderConfig)) {
  throw "Render CLI config not found. Run render login first."
}

$config = Get-Content -Raw -LiteralPath $RenderConfig
$apiKey = ([regex]::Match($config, "(?m)^\s+key:\s*(\S+)")).Groups[1].Value
if (-not $apiKey) {
  throw "Render API key not found in CLI config."
}

$headers = @{
  Authorization = "Bearer $apiKey"
  Accept = "application/json"
}

$values = [ordered]@{
  MARKET_PROVIDER = "itick"
  STRICT_REALTIME = "true"
  ITICK_BASE_URL = "https://api-free.itick.org"
  ITICK_FUND_REGION = "CN"
  ITICK_TOKEN = $Token
}

foreach ($item in $values.GetEnumerator()) {
  $body = @{ value = $item.Value } | ConvertTo-Json
  Invoke-RestMethod `
    -Method Put `
    -Uri "https://api.render.com/v1/services/$ServiceId/env-vars/$($item.Key)" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body | Out-Null
}

Write-Host "Market token configured. Trigger a Render redeploy for the service to apply it."
