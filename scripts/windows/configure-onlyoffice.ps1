# Prepares ONLYOFFICE Docs for SheetVault and copies its JWT secret into .env.local.
# Run in PowerShell **as Administrator** from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\configure-onlyoffice.ps1
param([int]$OnlyofficePort = 8080)
$ErrorActionPreference = "Stop"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Please run this script in PowerShell started with 'Run as administrator'." }

# Find the install folder from the DocService service (works for any drive).
$svc = Get-CimInstance Win32_Service -Filter "Name='DsDocServiceSvc'"
if (-not $svc) { throw "ONLYOFFICE Docs is not installed (service DsDocServiceSvc not found)." }
$exe = ($svc.PathName -split '"' | Where-Object { $_ -like "*WinSW*" } | Select-Object -First 1)
$root = Split-Path (Split-Path $exe -Parent) -Parent
$cfg = Join-Path $root "config\local.json"
Write-Host "ONLYOFFICE found in $root"

# 1) Allow Document Server to download files from SheetVault on this server / LAN.
Copy-Item $cfg "$cfg.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
$j = [IO.File]::ReadAllText($cfg) | ConvertFrom-Json
$rfa = [pscustomobject]@{ allowPrivateIPAddress = $true; allowMetaIPAddress = $false }
if ($j.services.CoAuthoring.PSObject.Properties.Name -contains "request-filtering-agent") { $j.services.CoAuthoring."request-filtering-agent" = $rfa }
else { $j.services.CoAuthoring | Add-Member -NotePropertyName "request-filtering-agent" -NotePropertyValue $rfa }
$json = $j | ConvertTo-Json -Depth 32
$null = $json | ConvertFrom-Json
[IO.File]::WriteAllText($cfg, $json, (New-Object Text.UTF8Encoding($false)))
Write-Host "  OK  allowPrivateIPAddress = true (backup kept next to local.json)" -ForegroundColor Green

# 2) Copy the JWT secret into SheetVault's .env.local.
$secret = $j.services.CoAuthoring.secret.inbox.string
if (-not $secret) { throw "No JWT secret found in $cfg (services.CoAuthoring.secret.inbox.string)." }
$envFile = Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path ".env.local"
if (Test-Path $envFile) {
  $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^ONLYOFFICE_JWT_SECRET=' }
  $lines += "ONLYOFFICE_JWT_SECRET=$secret"
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host "  OK  ONLYOFFICE_JWT_SECRET written to .env.local" -ForegroundColor Green
} else {
  Write-Warning ".env.local not found - run new-env.ps1 first, then run this script again."
}

# 3) Restart ONLYOFFICE, open its port on the LAN, check health.
Restart-Service DsConverterSvc, DsDocServiceSvc -Force
if (-not (Get-NetFirewallRule -DisplayName "ONLYOFFICE $OnlyofficePort" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "ONLYOFFICE $OnlyofficePort" -Direction Inbound -Protocol TCP -LocalPort $OnlyofficePort -Action Allow | Out-Null
  Write-Host "  OK  firewall opened for port $OnlyofficePort" -ForegroundColor Green
}
$healthy = $false
for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
  try { $healthy = (Invoke-WebRequest -UseBasicParsing "http://localhost:$OnlyofficePort/healthcheck" -TimeoutSec 5).Content -eq "true" } catch { Start-Sleep -Seconds 2 }
}
if ($healthy) { Write-Host "  OK  ONLYOFFICE healthcheck = true" -ForegroundColor Green }
else { Write-Warning "ONLYOFFICE did not report healthy yet. Check $root\Log" }
