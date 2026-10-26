# Creates .env.local for a Windows Server deployment (run from the project folder, PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\windows\new-env.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\windows\new-env.ps1 -ServerName qbd-server -Force
param(
  [string]$ServerName = $env:COMPUTERNAME,   # name or IP that users type in the browser
  [int]$AppPort = 3000,
  [int]$OnlyofficePort = 8080,
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$app = (Resolve-Path "$PSScriptRoot\..\..").Path
$envFile = Join-Path $app ".env.local"
if ((Test-Path $envFile) -and -not $Force) { throw ".env.local already exists. Use -Force to replace it (the old file is backed up)." }
if (Test-Path $envFile) { Copy-Item $envFile "$envFile.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }

Write-Host "Paste the PostgreSQL connection string (Neon, or the line printed by create-database.ps1)." -ForegroundColor Cyan
$sec = Read-Host "DATABASE_URL" -AsSecureString
$dbUrl = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($dbUrl -notmatch '^postgres(ql)?://') { throw "That does not look like a PostgreSQL URL (postgresql://...)." }

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$authSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })

$lines = @(
  "DATABASE_URL=$dbUrl",
  "AUTH_SECRET=$authSecret",
  "COOKIE_SECURE=false",
  "APP_INTERNAL_URL=http://localhost:$AppPort",
  "ONLYOFFICE_URL=http://${ServerName}:$OnlyofficePort",
  "ONLYOFFICE_INTERNAL_URL=http://localhost:$OnlyofficePort",
  "ONLYOFFICE_JWT_SECRET="
)
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
Write-Host "Created $envFile" -ForegroundColor Green
Write-Host "  Users will open:   http://${ServerName}:$AppPort"
Write-Host "  Editor address:    http://${ServerName}:$OnlyofficePort"
Write-Host "Next: run scripts\windows\configure-onlyoffice.ps1 (fills ONLYOFFICE_JWT_SECRET)."
