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

## Deploying to Vercel

Create a new Vercel project from this folder and set `DATABASE_URL` and `AUTH_SECRET` as environment variables.
Run `npm run db:migrate` once against the production database.
