import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fileAccess } from "@/lib/files";
import { intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// Everything needed for the per-file report: versions, review cycles, annotations, cell changes, audit trail.
export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { file, acl } = await fileAccess(u, id, "read");
  const [owner, versions, reviews, annotations, messages, changes, auditRows] = await Promise.all([
    q("SELECT full_name, employee_id FROM users WHERE id = $1", [file.owner_id]),
    q(
      `SELECT v.version_no, v.created_at, v.reason, v.size_bytes, v.sha256, u.full_name AS by, u.employee_id
       FROM file_versions v JOIN users u ON u.id = v.created_by WHERE v.file_id = $1 ORDER BY v.version_no`,
      [id],
    ),
    q(
      `SELECT r.*, su.full_name AS submitted_by_name, su.employee_id AS submitted_by_employee_id,
              ru.full_name AS reviewer_name, ru.employee_id AS reviewer_employee_id,
              (SELECT count(*)::int FROM annotations a WHERE a.review_id = r.id) AS annotations
       FROM reviews r JOIN users su ON su.id = r.submitted_by JOIN users ru ON ru.id = r.reviewer_id
       WHERE r.file_id = $1 ORDER BY r.id`,
      [id],
    ),
    q(
      `SELECT a.*, cu.full_name AS created_by_name, ru.full_name AS responded_by_name, xu.full_name AS closed_by_name
       FROM annotations a JOIN users cu ON cu.id = a.created_by
       LEFT JOIN users ru ON ru.id = a.responded_by LEFT JOIN users xu ON xu.id = a.closed_by
       WHERE a.file_id = $1 ORDER BY a.id`,
      [id],
    ),
    q(
      `SELECT m.*, u.full_name AS by_name FROM annotation_messages m
       JOIN annotations a ON a.id = m.annotation_id JOIN users u ON u.id = m.created_by
       WHERE a.file_id = $1 ORDER BY m.id`,
      [id],
    ),
    q(
      `SELECT c.*, u.full_name AS by, u.employee_id FROM cell_changes c JOIN users u ON u.id = c.changed_by
       WHERE c.file_id = $1 ORDER BY c.id`,
      [id],
    ),
    q(
      `SELECT id, ts, employee_id, user_name, action, details, reason, ip FROM audit_log
       WHERE entity_type = 'file' AND entity_id = $1 ORDER BY id`,
      [String(id)],
    ),
  ]);
  return json({
    file: { ...file, owner_name: owner[0]?.full_name, owner_employee_id: owner[0]?.employee_id },
    path: acl.path(file.folder_id).map((f) => f.name).join(" \\ "),
    versions,
    reviews,
    annotations,
    messages,
    changes,
    audit: auditRows,
    generatedAt: new Date().toISOString(),
    generatedBy: `${u.full_name} (${u.employee_id})`,
  });
});
