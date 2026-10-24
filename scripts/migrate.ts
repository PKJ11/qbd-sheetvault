// Usage: npm run db:migrate   (applies schema, creates the admin account and demo folders/templates once)
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { writeAudit, type Actor } from "../lib/audit";
import { TEMP_PASSWORD } from "../lib/constants";
import { one, pool, tx } from "../lib/db";
import { parseWorkbook } from "../lib/excel/parse";
import { storeVersion } from "../lib/files";

async function main() {
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await pool().query(schema);
  console.log("Schema applied.");

  const existing = await one<{ id: number }>("SELECT id FROM users WHERE upper(employee_id) = 'ADMIN'");
  if (existing) {
    console.log("Seed data already present - skipping.");
    return;
  }

  await tx(async (db) => {
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

    const folder = async (name: string, parent: number | null, inherit = true) => {
      const r = await db.query<{ id: number }>(
        "INSERT INTO folders (parent_id, name, inherit_permissions, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [parent, name, inherit, admin.id],
      );
      await writeAudit(db, actor, { action: "FOLDER_CREATED", entityType: "folder", entityId: r.rows[0].id, entityName: name });
      return r.rows[0].id;
    };
    const grant = async (folderId: number, type: string, value: string, perms: string[]) => {
      await db.query(
        "INSERT INTO permissions (resource_type, resource_id, principal_type, principal_value, perms, granted_by) VALUES ('folder',$1,$2,$3,$4,$5)",
        [folderId, type, value, perms, admin.id],
      );
      await writeAudit(db, actor, { action: "PERMISSION_GRANTED", entityType: "folder", entityId: folderId, details: { principal: `${type}:${value}`, perms } });
    };

    const templates = await folder("Validated Templates", null);
    await grant(templates, "everyone", "", ["read"]);
    await grant(templates, "role", "QA", ["read", "upload", "create", "edit", "review", "delete"]);
    await grant(templates, "role", "MANAGER", ["read", "review"]);

    const qc = await folder("Quality Control", null);
    await grant(qc, "role", "ANALYST", ["read", "edit", "upload", "create"]);
    await grant(qc, "role", "MANAGER", ["read", "edit", "upload", "create", "review", "delete"]);
    await grant(qc, "role", "QA", ["read", "review"]);
    const hplc = await folder("HPLC", qc);
    const gc = await folder("GC", qc);

    const qa = await folder("Quality Assurance", null, false);
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
      await writeAudit(db, actor, { action: "FILE_UPLOADED", entityType: "file", entityId: r.rows[0].id, entityName: f, details: { folder: "Validated Templates", size: buf.length, version: 1 } });
    }
    void hplc;
    void gc;
  });
  console.log(`Seeded. Sign in as ADMIN / ${TEMP_PASSWORD} (you will be asked to change it).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
