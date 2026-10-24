import bcrypt from "bcryptjs";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { clientIp, setSessionCookie, USER_COLUMNS, type User } from "@/lib/auth";
import { MAX_FAILED_LOGINS } from "@/lib/constants";
import { one, q } from "@/lib/db";
import { body, HttpError, json, route } from "@/lib/http";

const Input = z.object({ employeeId: z.string().trim().min(1), password: z.string().min(1) });

export const POST = route(async (req) => {
  const { employeeId, password } = Input.parse(await body(req));
  const ip = await clientIp();
  const u = await one<User & { password_hash: string; failed_attempts: number; locked_at: Date | null }>(
    `SELECT ${USER_COLUMNS}, password_hash, failed_attempts, locked_at FROM users WHERE upper(employee_id) = upper($1)`,
    [employeeId],
  );
  const fail = async (msg: string, details: object) => {
    await audit(
      { id: u?.id ?? null, employee_id: u?.employee_id ?? employeeId, full_name: u?.full_name ?? null, ip },
      { action: "LOGIN_FAILED", entityType: "auth", entityName: employeeId, details },
    );
    throw new HttpError(401, msg);
  };

  if (!u) return fail("Invalid Employee ID or password.", { reason: "unknown employee id" });
  if (!u.is_active) return fail("This account is deactivated. Contact the administrator.", { reason: "inactive" });
  if (u.locked_at) return fail("This account is locked after repeated failed sign-ins. Contact the administrator.", { reason: "locked" });

  if (!(await bcrypt.compare(password, u.password_hash))) {
    const attempts = u.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await q(`UPDATE users SET failed_attempts = $2, locked_at = CASE WHEN $3 THEN now() ELSE locked_at END WHERE id = $1`, [u.id, attempts, lock]);
    if (lock) {
      await audit({ id: u.id, employee_id: u.employee_id, full_name: u.full_name, ip }, { action: "ACCOUNT_LOCKED", entityType: "user", entityId: u.id, entityName: u.employee_id, details: { attempts } });
    }
    return fail(
      lock
        ? "Too many failed attempts. Your account is now locked; contact the administrator."
        : `Invalid Employee ID or password. ${MAX_FAILED_LOGINS - attempts} attempt(s) left before lock-out.`,
      { reason: "bad password", attempts },
    );
  }

  await q("UPDATE users SET failed_attempts = 0, last_login_at = now() WHERE id = $1", [u.id]);
  await setSessionCookie(u);
  await audit({ id: u.id, employee_id: u.employee_id, full_name: u.full_name, ip }, { action: "LOGIN", entityType: "auth", entityName: u.employee_id });
  return json({ ok: true, mustChangePassword: u.must_change_password });
});
