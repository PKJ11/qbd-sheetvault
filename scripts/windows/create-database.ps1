# Creates the SheetVault database and user on the local PostgreSQL server.
# Run in an elevated PowerShell on the server:  powershell -ExecutionPolicy Bypass -File scripts\windows\create-database.ps1
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$DbName = "sheetvault",
  [string]$DbUser = "sheetvault",
  [int]$Port = 5432
)
$ErrorActionPreference = "Stop"
$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) { throw "psql.exe not found in $PgBin. Pass -PgBin with your PostgreSQL bin folder." }

$superPw = Read-Host "Password of the PostgreSQL 'postgres' superuser" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($superPw))

# Random 32-character password for the application user.
$chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
$appPw = -join (1..32 | ForEach-Object { $chars | Get-Random })

$exists = & $psql -h localhost -p $Port -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DbUser'"
if ($exists -eq "1") {
  & $psql -h localhost -p $Port -U postgres -c "ALTER USER $DbUser WITH PASSWORD '$appPw';" | Out-Null
} else {
  & $psql -h localhost -p $Port -U postgres -c "CREATE USER $DbUser WITH PASSWORD '$appPw';" | Out-Null
}
$dbExists = & $psql -h localhost -p $Port -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
if ($dbExists -ne "1") { & $psql -h localhost -p $Port -U postgres -c "CREATE DATABASE $DbName OWNER $DbUser;" | Out-Null }
Remove-Item Env:PGPASSWORD

Write-Host ""
Write-Host "Database '$DbName' is ready. Put this line in .env.local (keep it secret):" -ForegroundColor Green
Write-Host "DATABASE_URL=postgresql://${DbUser}:${appPw}@localhost:${Port}/${DbName}"
