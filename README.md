# QbD SheetVault — Controlled Spreadsheet Management System

A Windows Explorer-style document system for QbD Excel calculation sheets: folders and workbooks with
permissions, in-browser data entry in validated templates, reviewer annotations, the author's corrections and
resubmission, review reports, and a hash-chained audit trail (21 CFR Part 11 / EU GMP Annex 11 style).

Stack: Next.js 16 (App Router) · Postgres (Neon) · ExcelJS + fast-formula-parser · Tailwind CSS. The visual style matches TCMS.

## Run locally

```bash
npm install
# .env.local needs DATABASE_URL (Neon) and AUTH_SECRET (32+ random chars)
npm run db:migrate      # creates tables, ADMIN account, demo folders, imports seed/*.xlsx as approved templates
npm run dev             # http://localhost:3000
```

First sign-in: **ADMIN / Qbd@1234**. You are forced to set a new password. New users created by an admin also get
the temporary password `Qbd@1234` and must change it at their first sign-in.

## Concepts

| Area | What it does |
|---|---|
| **File Explorer** | Windows 11 look: navigation tree, address bar/breadcrumb, command bar, details/large-icon views, right-click menus, drag-and-drop upload, Properties → General / Security tabs. Folders you can't open show a padlock, and opening one gives "Access denied" with a *Request access* option. |
| **Permissions** | `Read`, `Edit`, `Upload`, `Create`, `Delete`, `Review`, `Full control`. Grant them to a user, a role, a department, or Everyone. They inherit down the folder tree unless a folder or file turns inheritance off. Workbooks can have their own entries. Administrators have full access. A file's author always has Read and Edit on it. |
| **Roles** | System Administrator, QA Reviewer/Auditor, Manager (Reviewer), Analyst (Author), Viewer. Roles can be used in permission entries. Admin and QA see the global audit trail; Admin, QA and Managers see all reports. |
| **Workbooks** | Only *unlocked* cells of the protected template are editable (the template's own cell protection). Formulas recalculate live in the browser and again on the server when saving. Every save creates a new version (with SHA-256) and needs a reason for change. |
| **Review workflow** | Draft → *Submit* (pick a reviewer, e-signature) → In Review (locked) → reviewer adds cell annotations → *Request changes* or *Approve* (e-signature) → author edits, responds to each annotation and resubmits → … → Approved (read-only; *Start new revision* to reopen). The reviewer sees the cells changed since the last review outlined in blue. |
| **Reports** | Review register (status, cycles, times sent back, annotations open/addressed/closed, cell changes, average review time) with CSV export. Each workbook also has a printable report: review cycles with signatures, annotations and responses, cell change log, versions, and audit trail. |
| **Audit trail** | Append-only (enforced by a DB trigger) and SHA-256 hash-chained. Records who / when / what (old → new) / why / IP for sign-ins, edits, reviews, permissions, users, downloads and deletions. *Verify integrity* recomputes the chain. |
| **Security** | bcrypt passwords, password policy, lock-out after 5 failed attempts, 15-minute idle sign-out, sessions revoked on password reset, role change or deactivation, soft delete with an admin Recycle Bin. |

## Scripts

| Command | Purpose |
|---|---|
| `npm run db:migrate` | Apply schema (idempotent) and seed once |
| `npm run db:reset -- --yes` | **Dev only**: drop all tables, including the audit trail |
| `npm run audit:verify` | Verify the audit hash chain from the command line |
| `npm run test:engine` | Check the formula engine against the values Excel cached in `seed/*.xlsx` |
| `npm run test:e2e` | 95-check API workflow test (writes data; run against a dev DB with a running server) |

## Excel editor (ONLYOFFICE Docs Community)

When `ONLYOFFICE_URL`, `ONLYOFFICE_JWT_SECRET` and `APP_INTERNAL_URL` are set, workbooks open in a real spreadsheet
editor (ONLYOFFICE). There's also a **Grid** view, which is the built-in renderer.

- **Edit in Excel** checks the workbook out to one user. Nobody else can edit, submit or delete it until it is checked in
  or discarded. An admin can release a forgotten check-out; the reason is audited.
- The editor works on a **working copy**. **Check in** asks for a reason for change and pulls the latest content from
  the editor. It then verifies that no formula, locked cell, cell-lock setting, sheet or sheet protection changed, and
  stores the file as a new version with a cell-by-cell change log. Check-ins that alter the validated template are
  refused and audited (`CHECKIN_REJECTED_INTEGRITY`).
- Everyone else, and approved or in-review files, get a read-only editor view. Downloads stay in SheetVault, so they're audited.

## Windows Server deployment (no Docker, NSSM)

**Step-by-step guide: [docs/DEPLOY-WINDOWS.md](docs/DEPLOY-WINDOWS.md).** Summary:

1. Install **Node.js 22 LTS**. Put `nssm.exe` (2.24-101 pre-release) on PATH. The database is **Neon** (cloud) for now,
   so no local PostgreSQL is needed for SheetVault.
2. Install **ONLYOFFICE Docs Community for Windows** (version 10.x):
   `onlyoffice-documentserver.exe /SILENT /DS_PORT=8080`. It registers its own services (WinSW). Version 10 on Windows
   runs its converter and queue **in memory**: log line *"memory runtime detected"*. **RabbitMQ/Erlang are not needed.**
   `scripts\windows\install-rabbitmq.ps1` exists only for setups that are explicitly configured to use RabbitMQ.
3. In `C:\Program Files\ONLYOFFICE\DocumentServer\config\local.json`, note the JWT secret
   (`services.CoAuthoring.secret.inbox.string`). Set `services.CoAuthoring.request-filtering-agent.allowPrivateIPAddress`
   to `true` so it can fetch files from SheetVault on the same server. Restart the `ds-*` services.
4. *(Optional, only if moving off Neon)* `scripts\windows\create-database.ps1` creates a local `sheetvault` database.
5. Copy `.env.example` to `.env.local` and fill it in: the Neon `DATABASE_URL`, `AUTH_SECRET`, the ONLYOFFICE values,
   and `COOKIE_SECURE=false` for plain-HTTP LAN access.
6. `powershell -ExecutionPolicy Bypass -File scripts\windows\install-service.ps1` installs dependencies, migrates,
   builds, and registers and starts the **SheetVault** NSSM service on port 3000 (auto-start, restart on crash,
   rotating logs in `logs\`).
7. Open `http://<server>:3000` and sign in as `ADMIN` / `Qbd@1234`.

Updating: `nssm stop SheetVault`, copy the new code, then run `install-service.ps1` again.

## Deploying to Vercel

Create a new Vercel project from this folder and set `DATABASE_URL` and `AUTH_SECRET` as environment variables.
Run `npm run db:migrate` once against the production database.
