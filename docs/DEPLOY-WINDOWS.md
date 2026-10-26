# Deploying QbD SheetVault on Windows Server (no Docker, NSSM)

End result: on one Windows Server, **SheetVault** runs as an NSSM Windows service (port 3000) and
**ONLYOFFICE Docs Community** runs as its own Windows services (port 8080). Users open `http://<server>:3000`.
Run every command in **PowerShell started with "Run as administrator"**.

| | Minimum | Recommended |
|---|---|---|
| OS | Windows Server 2016 (64-bit) | Windows Server 2022 / 2025 |
| CPU / RAM / disk | 2 cores / 4 GB / 40 GB free | 4 cores / 8 GB / 60 GB |
| Network | fixed IP or DNS name; internet access during install (npm, downloads) | |

RabbitMQ and Erlang are **not needed**: ONLYOFFICE 10 on Windows uses its built-in in-memory queue.

---

## 1. Install the tools

With **winget** (Server 2025, or Server 2022 with App Installer):
```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e      # Node.js 24 LTS (needs >= 22.9)
winget install --id NSSM.NSSM -e
```
Without winget, download and install these manually:
- Git: https://git-scm.com/download/win
- Node.js **LTS** (x64 .msi): https://nodejs.org
- NSSM **2.24-101 pre-release**: https://nssm.cc/download. Copy `win64\nssm.exe` to `C:\Tools\nssm\` and add that folder to PATH.

**Close and reopen** PowerShell (as Administrator), then check:
```powershell
git --version; node -v; npm -v; nssm version
```

## 2. Install ONLYOFFICE Docs Community (the Excel editor)

1. Download **"ONLYOFFICE Docs Community - Windows"**:
   https://download.onlyoffice.com/install/documentserver/windows/onlyoffice-documentserver.exe
2. Install it silently on port 8080:
   ```powershell
   cd $env:USERPROFILE\Downloads
   (Get-AuthenticodeSignature .\onlyoffice-documentserver.exe).Status   # must say Valid (Ascensio System SIA)
   Start-Process .\onlyoffice-documentserver.exe -ArgumentList "/SILENT","/DS_PORT=8080" -Wait
   ```
3. Check it: open `http://localhost:8080/healthcheck`. It must show `true`.

## 3. Database (choose one)

**A. Neon (cloud PostgreSQL), as used so far.** Nothing to install. Use a **new Neon database for production**:
don't reuse the development one, which holds test data. Copy its connection string
(`postgresql://...neon.tech/...?sslmode=require&channel_binding=require`).
Pick the Neon region closest to the server, because every query travels there and back.

**B. Local PostgreSQL on the server.** This is faster (no internet round trips), but you take care of backups.
```powershell
winget install --id PostgreSQL.PostgreSQL.16 -e     # or the EDB installer from postgresql.org
```
Remember the `postgres` password you set. You create the SheetVault database in step 5.

## 4. Get the code

```powershell
mkdir C:\Apps -Force
cd C:\Apps
git clone https://github.com/PKJ11/qbd-sheetvault.git
cd C:\Apps\qbd-sheetvault
```
For a private repository, Git asks you to sign in to GitHub in the browser the first time.

## 5. Configure

```powershell
cd C:\Apps\qbd-sheetvault
# Only for option B (local PostgreSQL): creates the database and prints DATABASE_URL=...
powershell -ExecutionPolicy Bypass -File scripts\windows\create-database.ps1

# Creates .env.local: asks for the DATABASE_URL and generates a new AUTH_SECRET.
#   -ServerName = the name or IP users type in the browser (default: this computer's name)
powershell -ExecutionPolicy Bypass -File scripts\windows\new-env.ps1 -ServerName qbd-server

# Prepares ONLYOFFICE, writes its JWT secret into .env.local, opens port 8080.
powershell -ExecutionPolicy Bypass -File scripts\windows\configure-onlyoffice.ps1
```
`.env.local` holds secrets. It isn't in Git, so never commit or email it.

## 6. Build and install the Windows service (NSSM)

```powershell
cd C:\Apps\qbd-sheetvault
powershell -ExecutionPolicy Bypass -File scripts\windows\install-service.ps1
```
This runs `npm ci` → `npm run db:migrate` (creates the tables; on an empty database also the `ADMIN` account,
demo folders and the two validated templates) → `npm run build`. It then registers the **SheetVault** service:
auto-start, restart on crash, logs in `C:\Apps\qbd-sheetvault\logs\`, firewall port 3000.

## 7. Check that everything works

```powershell
Get-Service SheetVault, DsDocServiceSvc, DsConverterSvc, DsProxySvc    # all Running
Invoke-WebRequest -UseBasicParsing http://localhost:3000/login | Select-Object StatusCode   # 200
```
From a user's PC:
1. Open `http://qbd-server:3000` and sign in with **ADMIN / Qbd@1234**. You must set a new password.
2. Open *Validated Templates* and then a workbook. The **Excel editor** must show the sheet. If not, see Troubleshooting.
3. As an admin: create users (*Administration → Users*) and set folder permissions (*right-click folder → Properties → Security*).
4. Test once with a user: *New → Excel sheet from template → Edit in Excel → change an input cell → Check in*.
   Then check that a new version and the cell change appear under *Versions* and *Activity*.

## 8. Updating to a new version

```powershell
cd C:\Apps\qbd-sheetvault
git pull
powershell -ExecutionPolicy Bypass -File scripts\windows\install-service.ps1   # rebuilds, migrates, restarts
```
Migrations are additive and safe to re-run. Existing data is kept.

## Service commands

```powershell
nssm restart SheetVault        # or: Restart-Service SheetVault
nssm stop SheetVault
nssm edit SheetVault           # GUI for the service settings
Get-Content C:\Apps\qbd-sheetvault\logs\error.log -Tail 50
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in "works" but you are sent back to the login page | `.env.local` must contain `COOKIE_SECURE=false` while the site runs on plain `http://` |
| Editor area says *"Excel editor unavailable"* | `ONLYOFFICE_URL` must be the address **users' browsers** can reach (e.g. `http://qbd-server:8080`, not `localhost`). Port 8080 must be open in the firewall. |
| Editor opens but shows a download / access error | Run `configure-onlyoffice.ps1` again. It sets `allowPrivateIPAddress` and the JWT secret. Then `Restart-Service SheetVault`. |
| Check-in waits, then times out | ONLYOFFICE can't reach SheetVault: `APP_INTERNAL_URL` must be `http://localhost:3000` (same server). Check `logs\error.log`. |
| `npm ci` fails behind a company proxy | `npm config set proxy http://proxy:port` and `npm config set https-proxy http://proxy:port` |
| `install-service.ps1`: *nssm.exe not found* | Reopen PowerShell after installing NSSM, or pass `-Nssm C:\Tools\nssm\nssm.exe` |
| Service starts, then stops | `logs\error.log`. Usually a wrong `DATABASE_URL`, or the database is unreachable from the server. |
| Very slow saves and check-ins | Database far from the server (Neon region). Choose a closer region or use a local PostgreSQL. |
