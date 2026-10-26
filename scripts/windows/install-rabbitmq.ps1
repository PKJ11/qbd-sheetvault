# Downloads and installs Erlang/OTP + RabbitMQ on Windows, without Docker.
#
# NOTE: ONLYOFFICE Docs 10.x for Windows does NOT need RabbitMQ - it runs an in-memory queue with an embedded
# converter ("memory runtime detected" in Log\converter). Use this script only if your ONLYOFFICE setup is
# explicitly configured to use RabbitMQ (e.g. several converter servers).
#
# Run in PowerShell **as Administrator**:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-rabbitmq.ps1
#
# Options:
#   -ErlangVersion 28.5.0.8   -RabbitMQVersion 4.3.7   (must be a supported pair: https://www.rabbitmq.com/docs/which-erlang)
#   -DownloadOnly             only download + verify the installers (e.g. to copy them to an offline server)
#   -InstallerDir <folder>    use / keep installers in this folder
#   -EnableManagement         also enable the web dashboard on http://localhost:15672 (guest/guest, local only)
param(
  [string]$ErlangVersion = "28.5.0.8",
  [string]$RabbitMQVersion = "4.3.7",
  [string]$InstallerDir = "$env:USERPROFILE\Downloads\rabbitmq-setup",
  [switch]$DownloadOnly,
  [switch]$EnableManagement
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    OK  $msg" -ForegroundColor Green }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $DownloadOnly -and -not $isAdmin) { throw "Please run this script in PowerShell started with 'Run as administrator'." }

New-Item -ItemType Directory -Force $InstallerDir | Out-Null

# --- Download from official GitHub releases and verify SHA-256 --------------------------------------
function Get-VerifiedAsset([string]$repo, [string]$tag, [string]$assetName) {
  $target = Join-Path $InstallerDir $assetName
  $headers = @{ "User-Agent" = "sheetvault-setup"; "Accept" = "application/vnd.github+json" }
  $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers
  $asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
  if (-not $asset) { throw "$assetName not found in $repo release $tag" }
  $expected = $null
  if ($asset.digest -and $asset.digest -like "sha256:*") { $expected = $asset.digest.Substring(7).ToLower() }

  if (Test-Path $target) {
    $have = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
    if ($expected -and $have -eq $expected) { Ok "$assetName already downloaded and verified"; return $target }
    Remove-Item $target -Force
  }
  Write-Host "    downloading $assetName ($([math]::Round($asset.size / 1MB, 1)) MB) from github.com/$repo ..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $target -UseBasicParsing
  $actual = (Get-FileHash $target -Algorithm SHA256).Hash.ToLower()
  if ($expected) {
    if ($actual -ne $expected) { Remove-Item $target -Force; throw "SHA-256 mismatch for $assetName - download deleted. Expected $expected, got $actual" }
    Ok "$assetName SHA-256 verified ($actual)"
  } else {
    Write-Warning "GitHub did not publish a digest for $assetName. SHA-256: $actual - compare it with the release page before installing."
  }
  return $target
}

Step "Downloading Erlang/OTP $ErlangVersion and RabbitMQ $RabbitMQVersion"
$erlangExe = Get-VerifiedAsset "erlang/otp" "OTP-$ErlangVersion" "otp_win64_$ErlangVersion.exe"
$rabbitExe = Get-VerifiedAsset "rabbitmq/rabbitmq-server" "v$RabbitMQVersion" "rabbitmq-server-$RabbitMQVersion.exe"
if ($DownloadOnly) { Write-Host ""; Write-Host "Installers are in $InstallerDir" -ForegroundColor Green; exit 0 }

# --- Erlang -------------------------------------------------------------------------------------------
function Find-ErlangHome {
  $candidates = @("$env:ProgramFiles\Erlang OTP") + (Get-ChildItem "$env:ProgramFiles" -Directory -Filter "erl*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { $_.FullName })
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c "bin\erl.exe")) { return $c } }
  return $null
}

Step "Installing Erlang/OTP $ErlangVersion (silent)"
$p = Start-Process -FilePath $erlangExe -ArgumentList "/S" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Erlang installer failed with exit code $($p.ExitCode)" }
$erlHome = Find-ErlangHome
if (-not $erlHome) { throw "Erlang installed, but erl.exe was not found under $env:ProgramFiles" }
[Environment]::SetEnvironmentVariable("ERLANG_HOME", $erlHome, "Machine")
$env:ERLANG_HOME = $erlHome
Ok "Erlang installed in $erlHome (ERLANG_HOME set)"

# --- RabbitMQ -----------------------------------------------------------------------------------------
Step "Installing RabbitMQ $RabbitMQVersion (silent, registers the 'RabbitMQ' Windows service)"
$p = Start-Process -FilePath $rabbitExe -ArgumentList "/S" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "RabbitMQ installer failed with exit code $($p.ExitCode)" }
$sbin = Join-Path "$env:ProgramFiles\RabbitMQ Server\rabbitmq_server-$RabbitMQVersion" "sbin"
if (-not (Test-Path "$sbin\rabbitmqctl.bat")) { throw "RabbitMQ installed, but $sbin\rabbitmqctl.bat was not found" }

# rabbitmqctl authenticates with the Erlang cookie; the service creates it in the SYSTEM profile.
$systemCookie = "$env:SystemRoot\System32\config\systemprofile\.erlang.cookie"
for ($i = 0; $i -lt 30 -and -not (Test-Path $systemCookie); $i++) { Start-Sleep -Seconds 1 }
if (Test-Path $systemCookie) { Copy-Item $systemCookie "$env:USERPROFILE\.erlang.cookie" -Force; Ok "Erlang cookie synchronised for command-line tools" }

Set-Service RabbitMQ -StartupType Automatic
if ((Get-Service RabbitMQ).Status -ne "Running") { Start-Service RabbitMQ }
$listening = $false
for ($i = 0; $i -lt 60 -and -not $listening; $i++) {
  $listening = [bool](Get-NetTCPConnection -LocalPort 5672 -State Listen -ErrorAction SilentlyContinue)
  if (-not $listening) { Start-Sleep -Seconds 1 }
}
if (-not $listening) { throw "RabbitMQ service did not start listening on port 5672 within 60 s. Check $env:APPDATA\RabbitMQ\log" }
Ok "RabbitMQ service running on localhost:5672 (startup: Automatic)"

if ($EnableManagement) {
  & "$sbin\rabbitmq-plugins.bat" enable rabbitmq_management | Out-Null
  Ok "Management dashboard enabled: http://localhost:15672 (guest/guest, local only)"
}

# --- Reconnect ONLYOFFICE -----------------------------------------------------------------------------
$ds = Get-Service DsDocServiceSvc, DsConverterSvc -ErrorAction SilentlyContinue
if ($ds) {
  Step "Restarting ONLYOFFICE services so they connect to RabbitMQ"
  $ds | Restart-Service
  Start-Sleep -Seconds 10
  $queues = & "$sbin\rabbitmqctl.bat" list_queues name --quiet 2>$null
  if ($queues -match "^ds\.") { Ok "ONLYOFFICE is connected (queues: $((@($queues) -match '^ds\.') -join ', '))" }
  else { Write-Warning "ONLYOFFICE queues not visible yet. Wait a minute and run: & '$sbin\rabbitmqctl.bat' list_queues" }
} else {
  Write-Host "    (ONLYOFFICE services not found - install ONLYOFFICE next; it will use amqp://localhost:5672 by default)"
}

Write-Host ""
Write-Host "Done. Erlang $ErlangVersion + RabbitMQ $RabbitMQVersion installed. Installers kept in $InstallerDir" -ForegroundColor Green
Write-Host "Do NOT open port 5672 in the firewall - only ONLYOFFICE on this server needs it."
