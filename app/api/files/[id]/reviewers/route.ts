import { requireUser } from "@/lib/auth";
import { fileAccess } from "@/lib/files";
import { intParam, json, route } from "@/lib/http";
import { departmentManagers } from "@/lib/workflow";

type Ctx = { params: Promise<{ id: string }> };

// First-stage reviewers: managers of the author's department. Segregation of duties: the author and the
// submitter can't review their own work.
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { file, acl } = await fileAccess(u, intParam((await params).id), "read");
  const { department, managers } = await departmentManagers(acl, file, [u.id, file.owner_id]);
  return json({
    department,
    reviewers: managers.map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      full_name: r.full_name,
      designation: r.designation,
      department: r.department,
      isReportingManager: r.id === u.reporting_manager_id,
    })),
  });
});
