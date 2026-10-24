// DEVELOPMENT ONLY: adds demo users for trying the workflow. Usage: npm run db:seed-demo
// Every demo user starts with the temporary password and must change it at first sign-in.
import bcrypt from "bcryptjs";
import { writeAudit } from "../lib/audit";
import { TEMP_PASSWORD } from "../lib/constants";
import { one, pool, tx } from "../lib/db";

const DEMO = [
  { employee_id: "QBD100", full_name: "Meera Manager", designation: "Manager – QC", roles: ["MANAGER"], department: "Quality Control", manager: null },
  { employee_id: "QBD200", full_name: "Arjun Analyst", designation: "Executive – QC", roles: ["ANALYST"], department: "Quality Control", manager: "QBD100" },
  { employee_id: "QBD201", full_name: "Priya Analyst", designation: "Officer – QC", roles: ["ANALYST"], department: "Quality Control", manager: "QBD100" },
  { employee_id: "QBD300", full_name: "Vikram Viewer", designation: "Officer – Production", roles: ["VIEWER"], department: "Production", manager: null },
  { employee_id: "QBD400", full_name: "Qamar QA", designation: "Manager – QA", roles: ["QA"], department: "Quality Assurance", manager: null },
];

async function main() {
  const admin = await one<{ id: number; full_name: string }>("SELECT id, full_name FROM users WHERE upper(employee_id) = 'ADMIN'");
  if (!admin) throw new Error("Run npm run db:migrate first.");
  const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
  await tx(async (db) => {
    const actor = { id: admin.id, employee_id: "ADMIN", full_name: admin.full_name, ip: "seed-demo" };
    for (const d of DEMO) {
      const exists = await one("SELECT 1 FROM users WHERE upper(employee_id) = $1", [d.employee_id], db);
      if (exists) {
        console.log(`  ${d.employee_id} already exists - skipped`);
        continue;
      }
      const mgr = d.manager ? await one<{ id: number }>("SELECT id FROM users WHERE employee_id = $1", [d.manager], db) : null;
      const r = await db.query<{ id: number }>(
        `INSERT INTO users (employee_id, full_name, email, designation, joining_date, roles, department, unit, section,
                            reporting_manager_id, justification, password_hash, must_change_password, created_by)
         VALUES ($1,$2,$3,$4,'2024-04-01',$5,$6,'Unit 1','Analytical',$7,'Demo account for testing',$8,TRUE,$9) RETURNING id`,
        [d.employee_id, d.full_name, `${d.employee_id.toLowerCase()}@qbd.demo`, d.designation, d.roles, d.department, mgr?.id ?? null, hash, admin.id],
      );
      await writeAudit(db, actor, { action: "USER_CREATED", entityType: "user", entityId: r.rows[0].id, entityName: d.employee_id, reason: "Demo account for testing", details: { roles: d.roles, department: d.department } });
      console.log(`  created ${d.employee_id}  ${d.full_name.padEnd(16)} ${d.roles.join(",")}`);
    }
  });
  console.log(`\nAll demo users sign in with ${TEMP_PASSWORD} and must set a new password.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
