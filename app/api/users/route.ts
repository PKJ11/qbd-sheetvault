import bcrypt from "bcryptjs";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireAdmin } from "@/lib/auth";
import { TEMP_PASSWORD } from "@/lib/constants";
import { q, tx } from "@/lib/db";
import { body, HttpError, json, route } from "@/lib/http";
import { USER_LIST_SQL, UserInput } from "@/lib/users";

export const GET = route(async () => {
  await requireAdmin();
  const users = await q(`${USER_LIST_SQL} ORDER BY u.full_name`);
  return json({ users });
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const input = UserInput.parse(await body(req));
  const actor = await actorOf(admin);
  const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
  const created = await tx(async (db) => {
    if (input.reporting_manager_id) {
      const m = await db.query("SELECT 1 FROM users WHERE id = $1 AND is_active", [input.reporting_manager_id]);
      if (!m.rowCount) throw new HttpError(400, "Reporting manager not found or inactive.");
    }
    const r = await db.query<{ id: number }>(
      `INSERT INTO users (employee_id, full_name, email, designation, joining_date, roles, department, unit, section,
                          reporting_manager_id, justification, password_hash, must_change_password, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13) RETURNING id`,
      [input.employee_id.toUpperCase(), input.full_name, input.email, input.designation, input.joining_date, input.roles,
        input.department, input.unit, input.section || null, input.reporting_manager_id, input.justification, hash, admin.id],
    );
    const { justification, ...rest } = input;
    await writeAudit(db, actor, {
      action: "USER_CREATED",
      entityType: "user",
      entityId: r.rows[0].id,
      entityName: input.employee_id.toUpperCase(),
      reason: justification,
      details: { ...rest, employee_id: input.employee_id.toUpperCase(), temporaryPassword: "issued (must change at first sign-in)" },
    });
    return { id: r.rows[0].id };
  });
  return json({ ...created, temporaryPassword: TEMP_PASSWORD }, 201);
});
