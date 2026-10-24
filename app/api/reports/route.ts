import { audit } from "@/lib/audit";
import { actorOf, canSeeAllReports, requireUser } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { q } from "@/lib/db";
import { json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";

interface Row {
  id: number;
  name: string;
  folder_id: number;
  status: string;
  current_version: number;
  review_cycle: number;
  owner_id: number;
  inherit_permissions: boolean;
  owner: string;
  owner_employee_id: string;
  department: string | null;
  created_at: Date;
  updated_at: Date;
  reviewer: string | null;
  last_decision: string | null;
  last_decided_at: Date | null;
  approved_at: Date | null;
  approved_by: string | null;
  ann_total: number;
  ann_open: number;
  ann_addressed: number;
  ann_closed: number;
  cell_changes: number;
  changes_requested: number;
  avg_review_hours: number | null;
}

// Review-status report across files the caller may see (all files for Admin/QA/Managers).
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");
  const dept = sp.get("department");
  const search = sp.get("q")?.trim();

  const where: string[] = ["f.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    where.push(`f.status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`f.updated_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`f.updated_at < ($${params.length}::date + 1)`);
  }
  if (dept) {
    params.push(dept);
    where.push(`ou.department = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`f.name ILIKE $${params.length}`);
  }

  const rows = await q<Row>(
    `SELECT f.id, f.name, f.folder_id, f.status, f.current_version, f.review_cycle, f.owner_id, f.inherit_permissions,
            f.created_at, f.updated_at, ou.full_name AS owner, ou.employee_id AS owner_employee_id, ou.department,
            (SELECT ru.full_name FROM reviews r JOIN users ru ON ru.id = r.reviewer_id WHERE r.file_id = f.id ORDER BY r.id DESC LIMIT 1) AS reviewer,
            (SELECT r.decision FROM reviews r WHERE r.file_id = f.id AND r.decision IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS last_decision,
            (SELECT r.decided_at FROM reviews r WHERE r.file_id = f.id AND r.decision IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS last_decided_at,
            (SELECT r.decided_at FROM reviews r WHERE r.file_id = f.id AND r.decision = 'APPROVED' ORDER BY r.id DESC LIMIT 1) AS approved_at,
            (SELECT ru.full_name FROM reviews r JOIN users ru ON ru.id = r.reviewer_id WHERE r.file_id = f.id AND r.decision = 'APPROVED' ORDER BY r.id DESC LIMIT 1) AS approved_by,
            (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id) AS ann_total,
            (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'OPEN') AS ann_open,
            (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'ADDRESSED') AS ann_addressed,
            (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'CLOSED') AS ann_closed,
            (SELECT count(*)::int FROM cell_changes c WHERE c.file_id = f.id) AS cell_changes,
            (SELECT count(*)::int FROM reviews r WHERE r.file_id = f.id AND r.decision = 'CHANGES_REQUESTED') AS changes_requested,
            (SELECT round(avg(extract(epoch FROM (r.decided_at - r.submitted_at)) / 3600)::numeric, 1)::float
               FROM reviews r WHERE r.file_id = f.id AND r.decision IN ('APPROVED','CHANGES_REQUESTED')) AS avg_review_hours
     FROM files f JOIN users ou ON ou.id = f.owner_id
     WHERE ${where.join(" AND ")}
     ORDER BY f.updated_at DESC
     LIMIT 2000`,
    params,
  );

  const acl = await Acl.load();
  const all = canSeeAllReports(u);
  if (!all) await acl.loadFileAces(rows.map((r) => r.id));
  const visible = rows
    .filter((r) => acl.exists(r.folder_id) && (all || acl.filePerms(u, r).has("read")))
    .map((r) => ({ ...r, path: acl.path(r.folder_id).map((f) => f.name).join(" \\ ") }));

  if (sp.get("format") === "csv") {
    await audit(await actorOf(u), { action: "REPORT_EXPORTED", entityType: "report", entityName: "Review status report", details: { rows: visible.length, filters: Object.fromEntries(sp) } });
    const csv = toCsv(visible as unknown as Record<string, unknown>[], [
      { key: "id", label: "File ID" },
      { key: "name", label: "File" },
      { key: "path", label: "Folder" },
      { key: "status", label: "Status" },
      { key: "current_version", label: "Version" },
      { key: "review_cycle", label: "Review cycles" },
      { key: "changes_requested", label: "Times changes requested" },
      { key: "owner", label: "Author" },
      { key: "owner_employee_id", label: "Author Emp ID" },
      { key: "department", label: "Department" },
      { key: "reviewer", label: "Reviewer (latest)" },
      { key: "approved_by", label: "Approved by" },
      { key: "approved_at", label: "Approved at" },
      { key: "ann_total", label: "Annotations" },
      { key: "ann_open", label: "Open" },
      { key: "ann_addressed", label: "Addressed" },
      { key: "ann_closed", label: "Closed" },
      { key: "cell_changes", label: "Cell changes" },
      { key: "avg_review_hours", label: "Avg review time (h)" },
      { key: "updated_at", label: "Last updated" },
    ]);
    return csvResponse(csv, `sheetvault-review-report-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const summary = {
    total: visible.length,
    byStatus: visible.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
    openAnnotations: visible.reduce((a, r) => a + r.ann_open, 0),
    addressedAnnotations: visible.reduce((a, r) => a + r.ann_addressed, 0),
    closedAnnotations: visible.reduce((a, r) => a + r.ann_closed, 0),
    reviewCycles: visible.reduce((a, r) => a + r.review_cycle, 0),
    avgReviewHours: (() => {
      const xs = visible.map((r) => r.avg_review_hours).filter((x): x is number => x !== null);
      return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
    })(),
  };
  const departments = await q<{ department: string }>("SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY 1");
  return json({ rows: visible, summary, departments: departments.map((d) => d.department), scope: all ? "all" : "accessible" });
});
