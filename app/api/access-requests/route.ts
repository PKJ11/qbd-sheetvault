import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, isAdmin, requireUser } from "@/lib/auth";
import { PERM_KEYS } from "@/lib/constants";
import { one, q, tx } from "@/lib/db";
import { body, HttpError, json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";

const Input = z.object({
  resourceType: z.literal("folder"),
  resourceId: z.number().int().positive(),
  perms: z.array(z.enum(PERM_KEYS as [string, ...string[]])).min(1),
  justification: z.string().trim().min(5, "please explain why you need access").max(2000),
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const input = Input.parse(await body(req));
  const acl = await Acl.load();
  if (!acl.exists(input.resourceId)) throw new HttpError(404, "Folder not found.");
  const actor = await actorOf(u);
  await tx(async (db) => {
    // Serialise per user+folder so a double-click can't create two pending requests.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('access-request:' || $1::text || ':' || $2::text))", [u.id, input.resourceId]);
    const pending = await one(
      "SELECT 1 FROM access_requests WHERE requested_by = $1 AND resource_type = 'folder' AND resource_id = $2 AND status = 'PENDING'",
      [u.id, input.resourceId],
      db,
    );
    if (pending) throw new HttpError(409, "You already have a pending request for this folder.");
    const r = await db.query<{ id: number }>(
      `INSERT INTO access_requests (resource_type, resource_id, requested_by, requested_perms, justification)
       VALUES ('folder',$1,$2,$3,$4) RETURNING id`,
      [input.resourceId, u.id, input.perms, input.justification],
    );
    await writeAudit(db, actor, {
      action: "ACCESS_REQUESTED",
      entityType: "folder",
      entityId: input.resourceId,
      entityName: acl.folders.get(input.resourceId)!.name,
      reason: input.justification,
      details: { requestId: r.rows[0].id, perms: input.perms },
    });
  });
  return json({ ok: true }, 201);
});

// Admins see every request; folder managers see requests for folders they control.
export const GET = route(async (req) => {
  const u = await requireUser();
  const status = new URL(req.url).searchParams.get("status") ?? "PENDING";
  const rows = await q<{ resource_id: number }>(
    `SELECT ar.*, ru.full_name AS requested_by_name, ru.employee_id AS requested_by_employee_id, ru.department,
            du.full_name AS decided_by_name
     FROM access_requests ar JOIN users ru ON ru.id = ar.requested_by LEFT JOIN users du ON du.id = ar.decided_by
     WHERE ($1 = 'ALL' OR ar.status = $1) ORDER BY ar.id DESC LIMIT 500`,
    [status],
  );
  const acl = await Acl.load();
  const visible = rows
    .filter((r) => isAdmin(u) || acl.folderPerms(u, r.resource_id).has("manage"))
    .map((r) => ({ ...r, path: acl.path(r.resource_id).map((f) => f.name).join(" \\ ") || "(deleted folder)" }));
  return json({ requests: visible });
});
