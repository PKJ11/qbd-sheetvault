import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { json, route } from "@/lib/http";

// Minimal user list for pickers (permissions, reviewers). Any signed-in user.
export const GET = route(async () => {
  await requireUser();
  const [users, departments] = await Promise.all([
    q("SELECT id, employee_id, full_name, designation, department, roles FROM users WHERE is_active ORDER BY full_name"),
    q<{ department: string }>("SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department <> '' ORDER BY 1"),
  ]);
  return json({ users, departments: departments.map((d) => d.department) });
});
