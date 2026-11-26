// Usage: npm run db:migrate   (applies schema, creates the admin account and demo folders/templates once,
// and on every run makes sure the workflow's system folders exist: Quality Control \ Validated Templates, Quality Assurance)
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { writeAudit, type Actor } from "../lib/audit";
import { TEMP_PASSWORD } from "../lib/constants";
import { one, pool, tx } from "../lib/db";
import { parseWorkbook } from "../lib/excel/parse";
import { storeVersion } from "../lib/files";

const QC_NAME = "Quality Control";
const TEMPLATES_NAME = "Validated Templates";
const QA_NAME = "Quality Assurance";

function helpers(db: PoolClient, actor: Actor) {
  const folder = async (name: string, parent: number | null, inherit = true, systemKey: string | null = null) => {
    const r = await db.query<{ id: number }>(
      "INSERT INTO folders (parent_id, name, inherit_permissions, created_by, system_key) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [parent, name, inherit, actor.id, systemKey],
    );
    await writeAudit(db, actor, { action: "FOLDER_CREATED", entityType: "folder", entityId: r.rows[0].id, entityName: name, details: systemKey ? { systemFolder: systemKey } : undefined });
    return r.rows[0].id;
  };
  const grant = async (folderId: number, type: string, value: string, perms: string[]) => {
    await db.query(
      "INSERT INTO permissions (resource_type, resource_id, principal_type, principal_value, perms, granted_by) VALUES ('folder',$1,$2,$3,$4,$5)",
      [folderId, type, value, perms, actor.id],
    );
    await writeAudit(db, actor, { action: "PERMISSION_GRANTED", entityType: "folder", entityId: folderId, details: { principal: `${type}:${value}`, perms } });
  };
  return { folder, grant };
}

async function seed(db: PoolClient) {
  const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
  const admin = (await db.query<{ id: number }>(
    `INSERT INTO users (employee_id, full_name, email, designation, roles, department, unit, section, justification, password_hash, must_change_password)
     VALUES ('ADMIN','System Administrator','admin@qbdresearch.local','IT Administrator',ARRAY['ADMIN'],'IT','Unit 1','IT',
             'Initial system administrator account',$1,TRUE) RETURNING id`,
    [hash],
  )).rows[0];
  const actor: Actor = { id: admin.id, employee_id: "ADMIN", full_name: "System Administrator", ip: "system" };
  await writeAudit(db, actor, { action: "SYSTEM_INITIALISED", entityType: "system", details: { note: "Schema created and seed data loaded" } });
  await writeAudit(db, actor, { action: "USER_CREATED", entityType: "user", entityId: admin.id, entityName: "ADMIN", details: { roles: ["ADMIN"] } });
  const { folder, grant } = helpers(db, actor);

  const qc = await folder(QC_NAME, null, true, "QC");
  await grant(qc, "role", "ANALYST", ["read", "edit", "upload", "create"]);
  await grant(qc, "role", "MANAGER", ["read", "edit", "upload", "create", "review", "delete"]);
  await grant(qc, "role", "QA", ["read", "review"]);
  await folder("HPLC", qc);
  await folder("GC", qc);

  // Templates live inside Quality Control but don't inherit its rights: analysts must not edit or upload templates.
  const templates = await folder(TEMPLATES_NAME, qc, false, "TEMPLATES");
  await grant(templates, "everyone", "", ["read"]);
  await grant(templates, "role", "QA", ["read", "upload", "create", "edit", "review", "delete"]);
  await grant(templates, "role", "MANAGER", ["read", "review"]);

  const qa = await folder(QA_NAME, null, false, "QA");
  await grant(qa, "role", "QA", ["manage"]);

  await folder("Regulatory Submissions", null, false);

  const seedDir = path.join(process.cwd(), "seed");
  for (const f of fs.readdirSync(seedDir).filter((x) => x.toLowerCase().endsWith(".xlsx"))) {
    const buf = fs.readFileSync(path.join(seedDir, f));
    const model = await parseWorkbook(buf);
    const r = await db.query<{ id: number }>(
      `INSERT INTO files (folder_id, name, owner_id, status, size_bytes, updated_by) VALUES ($1,$2,$3,'APPROVED',$4,$3) RETURNING id`,
      [templates, f, admin.id, buf.length],
    );
    await storeVersion(db, r.rows[0].id, 1, buf, model, admin.id, "Validated template imported");
    await writeAudit(db, actor, { action: "FILE_UPLOADED", entityType: "file", entityId: r.rows[0].id, entityName: f, details: { folder: `${QC_NAME} \\ ${TEMPLATES_NAME}`, size: buf.length, version: 1 } });
  }
}

/**
 * Existing databases: tag the workflow's folders and move "Validated Templates" into Quality Control.
 * Idempotent - does nothing once every system folder is tagged.
 */
async function ensureSystemFolders(db: PoolClient) {
  const tagged = await db.query<{ system_key: string }>("SELECT system_key FROM folders WHERE system_key IS NOT NULL AND deleted_at IS NULL");
  const have = new Set(tagged.rows.map((r) => r.system_key));
  if (have.has("QC") && have.has("TEMPLATES") && have.has("QA")) return;

  const admin = await one<{ id: number; full_name: string }>("SELECT id, full_name FROM users WHERE upper(employee_id) = 'ADMIN'", [], db);
  if (!admin) throw new Error("ADMIN account missing");
  const actor: Actor = { id: admin.id, employee_id: "ADMIN", full_name: admin.full_name, ip: "migration" };
  const { folder, grant } = helpers(db, actor);
  const byName = (name: string, parent: number | null) =>
    one<{ id: number; parent_id: number | null; system_key: string | null }>(
      "SELECT id, parent_id, system_key FROM folders WHERE lower(name) = lower($1) AND parent_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL",
      [name, parent],
      db,
    );
  const tag = async (id: number, key: string, name: string) => {
    await db.query("UPDATE folders SET system_key = $2 WHERE id = $1", [id, key]);
    await writeAudit(db, actor, { action: "FOLDER_MARKED_SYSTEM", entityType: "folder", entityId: id, entityName: name, reason: "Two-stage approval workflow", details: { systemFolder: key } });
    console.log(`  ${name}: marked as system folder ${key}`);
  };

  let qcId: number;
  if (have.has("QC")) qcId = (await one<{ id: number }>("SELECT id FROM folders WHERE system_key = 'QC'", [], db))!.id;
  else {
    const qc = await byName(QC_NAME, null);
    qcId = qc ? qc.id : await folder(QC_NAME, null, true, null);
    await tag(qcId, "QC", QC_NAME);
  }

  if (!have.has("TEMPLATES")) {
    const inside = await byName(TEMPLATES_NAME, qcId);
    const atRoot = await byName(TEMPLATES_NAME, null);
    const t = inside ?? atRoot;
    if (t) {
      if (t.parent_id !== qcId) {
        // Move it under Quality Control; keep its own permissions instead of inheriting Quality Control's.
        await db.query("UPDATE folders SET parent_id = $2, inherit_permissions = FALSE, updated_at = now() WHERE id = $1", [t.id, qcId]);
        await writeAudit(db, actor, {
          action: "FOLDER_MOVED",
          entityType: "folder",
          entityId: t.id,
          entityName: TEMPLATES_NAME,
          reason: "Validated templates are kept in the Quality Control folder only",
          details: { from: "(root)", to: QC_NAME, inheritPermissions: false },
        });
        console.log(`  ${TEMPLATES_NAME}: moved into ${QC_NAME}`);
      }
      await tag(t.id, "TEMPLATES", TEMPLATES_NAME);
    } else {
      const id = await folder(TEMPLATES_NAME, qcId, false, null);
      await grant(id, "everyone", "", ["read"]);
      await grant(id, "role", "QA", ["read", "upload", "create", "edit", "review", "delete"]);
      await grant(id, "role", "MANAGER", ["read", "review"]);
      await tag(id, "TEMPLATES", TEMPLATES_NAME);
    }
  }

  if (!have.has("QA")) {
    const qa = await byName(QA_NAME, null);
    let id = qa?.id;
    if (!id) {
      id = await folder(QA_NAME, null, false, null);
      await grant(id, "role", "QA", ["manage"]);
    }
    await tag(id, "QA", QA_NAME);
  }
}

async function main() {
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await pool().query(schema);
  console.log("Schema applied.");

  const existing = await one<{ id: number }>("SELECT id FROM users WHERE upper(employee_id) = 'ADMIN'");
  if (existing) console.log("Seed data already present - skipping seed.");
  else {
    await tx(seed);
    console.log(`Seeded. Sign in as ADMIN / ${TEMP_PASSWORD} (you will be asked to change it).`);
  }
  await tx(ensureSystemFolders);
  console.log("System folders OK.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
