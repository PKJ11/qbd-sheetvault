# Builds SheetVault and registers it as a Windows service with NSSM.
# Run in an elevated PowerShell from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-service.ps1
param(
  [string]$ServiceName = "SheetVault",
  [int]$Port = 3000,
  [string]$Nssm = "nssm.exe",
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$app = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue)) { throw "nssm.exe not found. Put it on PATH or pass -Nssm C:\Tools\nssm\nssm.exe" }
if (-not (Test-Path "$app\.env.local")) { throw ".env.local is missing in $app (see .env.example)." }

Push-Location $app
try {
  if (-not $SkipBuild) {
    Write-Host "Installing dependencies and building..." -ForegroundColor Cyan
    npm ci; if ($LASTEXITCODE) { throw "npm ci failed" }
    npm run db:migrate; if ($LASTEXITCODE) { throw "database migration failed" }
    npm run build; if ($LASTEXITCODE) { throw "build failed" }
  }
  New-Item -ItemType Directory -Force "$app\logs" | Out-Null

  if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
    & $Nssm stop $ServiceName | Out-Null
    & $Nssm remove $ServiceName confirm | Out-Null
  }
  & $Nssm install $ServiceName $node "node_modules\next\dist\bin\next start -p $Port"
  & $Nssm set $ServiceName AppDirectory $app
  & $Nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
  & $Nssm set $ServiceName DisplayName "QbD SheetVault"
  & $Nssm set $ServiceName Description "QbD SheetVault - controlled spreadsheet management (Next.js)"
  & $Nssm set $ServiceName Start SERVICE_AUTO_START
  & $Nssm set $ServiceName AppStdout "$app\logs\out.log"
  & $Nssm set $ServiceName AppStderr "$app\logs\error.log"
  & $Nssm set $ServiceName AppRotateFiles 1
  & $Nssm set $ServiceName AppRotateOnline 1
  & $Nssm set $ServiceName AppRotateBytes 10485760
  & $Nssm set $ServiceName AppExit Default Restart
  & $Nssm set $ServiceName AppRestartDelay 5000
  & $Nssm start $ServiceName

  if (-not (Get-NetFirewallRule -DisplayName "SheetVault $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "SheetVault $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
  }
  Write-Host "SheetVault is running as service '$ServiceName' on port $Port. Logs: $app\logs" -ForegroundColor Green
} finally {
  Pop-Location
}
