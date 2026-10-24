import { z } from "zod";
import { ROLE_KEYS } from "./constants";

export const USER_LIST_SQL = `
  SELECT u.id, u.employee_id, u.full_name, u.email, u.designation, to_char(u.joining_date, 'YYYY-MM-DD') AS joining_date,
         u.roles, u.department, u.unit, u.section, u.reporting_manager_id, m.full_name AS reporting_manager_name,
         u.justification, u.must_change_password, u.is_active, u.locked_at, u.failed_attempts, u.last_login_at,
         u.created_at, u.updated_at
  FROM users u LEFT JOIN users m ON m.id = u.reporting_manager_id`;

export const UserInput = z.object({
  employee_id: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9._-]+$/, "letters, numbers, . _ - only"),
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  designation: z.string().trim().min(1).max(120),
  joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  roles: z.array(z.enum(ROLE_KEYS as [string, ...string[]])).min(1, "select at least one role"),
  department: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(120),
  section: z.string().trim().max(120).optional().default(""),
  reporting_manager_id: z.number().int().positive().nullable(),
  justification: z.string().trim().min(5, "explain why access is needed").max(2000),
});
