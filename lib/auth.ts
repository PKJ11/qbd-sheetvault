import "server-only";
import { cookies, headers } from "next/headers";
import type { Actor } from "./audit";
import { one } from "./db";
import { HttpError } from "./http";
import { readSession, SESSION_COOKIE, SESSION_HOURS, signSession } from "./session";

export interface User {
  id: number;
  employee_id: string;
  full_name: string;
  email: string;
  designation: string | null;
  roles: string[];
  department: string | null;
  unit: string | null;
  section: string | null;
  reporting_manager_id: number | null;
  must_change_password: boolean;
  is_active: boolean;
  session_version: number;
}

export const USER_COLUMNS =
  "id, employee_id, full_name, email, designation, roles, department, unit, section, reporting_manager_id, must_change_password, is_active, session_version";

export const isAdmin = (u: Pick<User, "roles">) => u.roles.includes("ADMIN");
export const canSeeAllReports = (u: Pick<User, "roles">) =>
  u.roles.some((r) => r === "ADMIN" || r === "QA" || r === "MANAGER");
export const canSeeAuditTrail = (u: Pick<User, "roles">) => u.roles.some((r) => r === "ADMIN" || r === "QA");

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? null;
}

export async function actorOf(u: Pick<User, "id" | "employee_id" | "full_name">): Promise<Actor> {
  return { id: u.id, employee_id: u.employee_id, full_name: u.full_name, ip: await clientIp() };
}

export async function setSessionCookie(u: Pick<User, "id" | "session_version" | "must_change_password">) {
  const token = await signSession({ uid: u.id, sv: u.session_version, mcp: u.must_change_password });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // HTTPS-only in production, unless the site is deliberately served over plain HTTP on the office LAN.
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Current user, or null. Validates the token against the DB (active + session version). */
export async function currentUser(): Promise<User | null> {
  const claims = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const u = await one<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [claims.uid]);
  if (!u || !u.is_active || u.session_version !== claims.sv) return null;
  return u;
}

/** For API routes. Users who still must change their password are blocked unless allowed. */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Your session has expired. Please sign in again.");
  if (u.must_change_password && !opts.allowPasswordChange)
    throw new HttpError(403, "You must change your temporary password first.");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!isAdmin(u)) throw new HttpError(403, "Administrator access required.");
  return u;
}
