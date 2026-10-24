import { audit } from "@/lib/audit";
import { actorOf, canSeeAuditTrail, requireUser } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { q } from "@/lib/db";
import { fileAccess } from "@/lib/files";
import { HttpError, json, route } from "@/lib/http";

// Audit trail. Admin/QA see everything; others may only query the trail of a file they can read.
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const entityType = sp.get("entityType");
  const entityId = sp.get("entityId");

  if (!canSeeAuditTrail(u)) {
    if (entityType !== "file" || !entityId) throw new HttpError(403, "Audit trail access requires the Admin or QA role.");
    await fileAccess(u, Number(entityId), "read");
  }

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (entityType) add("entity_type = ?", entityType);
  if (entityId) add("entity_id = ?", entityId);
  if (sp.get("action")) add("action = ?", sp.get("action"));
  if (sp.get("user")) add("(employee_id ILIKE ? OR user_name ILIKE $" + (params.length + 1) + ")", `%${sp.get("user")}%`);
  if (sp.get("from")) add("ts >= ?::date", sp.get("from"));
  if (sp.get("to")) add("ts < (?::date + 1)", sp.get("to"));
  if (sp.get("q")) add("(entity_name ILIKE ? OR details::text ILIKE $" + (params.length + 1) + " OR reason ILIKE $" + (params.length + 1) + ")", `%${sp.get("q")}%`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  if (sp.get("format") === "csv") {
    const rows = await q(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT 50000`, params);
    await audit(await actorOf(u), { action: "AUDIT_TRAIL_EXPORTED", entityType: "report", entityName: "Audit trail", details: { rows: rows.length, filters: Object.fromEntries(sp) } });
    return csvResponse(
      toCsv(rows, [
        { key: "id", label: "Seq" },
        { key: "ts", label: "Timestamp (UTC)" },
        { key: "employee_id", label: "Employee ID" },
        { key: "user_name", label: "User" },
        { key: "action", label: "Action" },
        { key: "entity_type", label: "Entity type" },
        { key: "entity_id", label: "Entity ID" },
        { key: "entity_name", label: "Entity" },
        { key: "details", label: "Details" },
        { key: "reason", label: "Reason" },
        { key: "ip", label: "IP" },
        { key: "hash", label: "Record hash" },
      ]),
      `sheetvault-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const size = Math.min(200, Math.max(10, Number(sp.get("size") ?? 50)));
  const [rows, total, actions] = await Promise.all([
    q(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
    q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log ${whereSql}`, params),
    q<{ action: string }>("SELECT DISTINCT action FROM audit_log ORDER BY 1"),
  ]);
  return json({ rows, total: total[0].n, page, size, actions: actions.map((a) => a.action) });
});
