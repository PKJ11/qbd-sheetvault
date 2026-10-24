import bcrypt from "bcryptjs";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser, setSessionCookie } from "@/lib/auth";
import { passwordProblems, TEMP_PASSWORD } from "@/lib/constants";
import { one, tx } from "@/lib/db";
import { body, HttpError, json, route } from "@/lib/http";

const Input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

export const POST = route(async (req) => {
  const u = await requireUser({ allowPasswordChange: true });
  const { currentPassword, newPassword } = Input.parse(await body(req));
  const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [u.id]);
  if (!row || !(await bcrypt.compare(currentPassword, row.password_hash)))
    throw new HttpError(400, "Current password is incorrect.");
  const problems = passwordProblems(newPassword);
  if (problems.length) throw new HttpError(400, `New password needs ${problems.join(", ")}.`);
  if (newPassword === TEMP_PASSWORD || newPassword === currentPassword)
    throw new HttpError(400, "New password must be different from the temporary/current password.");
  if (newPassword.toLowerCase().includes(u.employee_id.toLowerCase()))
    throw new HttpError(400, "Password must not contain your Employee ID.");

  const hash = await bcrypt.hash(newPassword, 10);
  const actor = await actorOf(u);
  const updated = await tx(async (db) => {
    const r = await db.query<{ session_version: number }>(
      `UPDATE users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now(),
              session_version = session_version + 1, updated_at = now()
       WHERE id = $1 RETURNING session_version`,
      [u.id, hash],
    );
    await writeAudit(db, actor, {
      action: u.must_change_password ? "TEMP_PASSWORD_CHANGED" : "PASSWORD_CHANGED",
      entityType: "user",
      entityId: u.id,
      entityName: u.employee_id,
    });
    return r.rows[0];
  });
  await setSessionCookie({ id: u.id, session_version: updated.session_version, must_change_password: false });
  return json({ ok: true });
});
