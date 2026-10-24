import bcrypt from "bcryptjs";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireAdmin } from "@/lib/auth";
import { TEMP_PASSWORD } from "@/lib/constants";
import { one, tx } from "@/lib/db";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { USER_LIST_SQL, UserInput } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

const Action = z.object({
  action: z.enum(["update", "reset_password", "unlock", "deactivate", "activate"]),
  reason: z.string().trim().min(3, "a reason is required").max(1000),
  data: UserInput.partial().optional(),
});

const FIELDS = ["employee_id", "full_name", "email", "designation", "joining_date", "roles", "department", "unit", "section", "reporting_manager_id", "justification"] as const;

export const PATCH = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const id = intParam((await params).id);
  const input = Action.parse(await body(req));
  const actor = await actorOf(admin);
  const before = await one<Record<string, unknown>>(`${USER_LIST_SQL} WHERE u.id = $1`, [id]);
  if (!before) throw new HttpError(404, "User not found.");
  if (id === admin.id && (input.action === "deactivate" || (input.action === "update" && input.data?.roles && !input.data.roles.includes("ADMIN"))))
    throw new HttpError(400, "You can't deactivate yourself or remove your own administrator role.");

  await tx(async (db) => {
    switch (input.action) {
      case "update": {
        const data = input.data ?? {};
        if (data.reporting_manager_id === id) throw new HttpError(400, "A user can't report to themselves.");
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const sets: string[] = [];
        const vals: unknown[] = [id];
        for (const f of FIELDS) {
          if (!(f in data)) continue;
          let v = (data as Record<string, unknown>)[f];
          if (f === "employee_id") v = String(v).toUpperCase();
          if (f === "section" && v === "") v = null;
          const old = before[f];
          if (JSON.stringify(old ?? null) === JSON.stringify(v ?? null)) continue;
          changes[f] = { from: old ?? null, to: v ?? null };
          vals.push(v);
          sets.push(`${f} = $${vals.length}`);
        }
        if (!sets.length) return;
        await db.query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
        if (changes.roles) await db.query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [id]);
        await writeAudit(db, actor, { action: "USER_UPDATED", entityType: "user", entityId: id, entityName: String(before.employee_id), reason: input.reason, details: changes });
        return;
      }
      case "reset_password": {
        const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
        await db.query(
          `UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_attempts = 0, locked_at = NULL,
                  session_version = session_version + 1, updated_at = now() WHERE id = $1`,
          [id, hash],
        );
        await writeAudit(db, actor, { action: "PASSWORD_RESET", entityType: "user", entityId: id, entityName: String(before.employee_id), reason: input.reason, details: { temporaryPassword: "re-issued (must change at next sign-in)" } });
        return;
      }
      case "unlock":
        await db.query("UPDATE users SET failed_attempts = 0, locked_at = NULL, updated_at = now() WHERE id = $1", [id]);
        await writeAudit(db, actor, { action: "ACCOUNT_UNLOCKED", entityType: "user", entityId: id, entityName: String(before.employee_id), reason: input.reason });
        return;
      case "deactivate":
      case "activate": {
        const active = input.action === "activate";
        await db.query("UPDATE users SET is_active = $2, session_version = session_version + 1, updated_at = now() WHERE id = $1", [id, active]);
        await writeAudit(db, actor, { action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", entityType: "user", entityId: id, entityName: String(before.employee_id), reason: input.reason });
        return;
      }
    }
  });
  return json({ ok: true, ...(input.action === "reset_password" ? { temporaryPassword: TEMP_PASSWORD } : {}) });
});
