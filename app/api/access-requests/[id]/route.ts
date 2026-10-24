import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { PERM_KEYS } from "@/lib/constants";
import { one, tx } from "@/lib/db";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { Acl, assertPerm } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
  perms: z.array(z.enum(PERM_KEYS as [string, ...string[]])).optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  const actor = await actorOf(u);
  await tx(async (db) => {
    const r = await one<{ id: number; resource_id: number; requested_by: number; requested_perms: string[]; status: string }>(
      "SELECT * FROM access_requests WHERE id = $1 FOR UPDATE",
      [id],
      db,
    );
    if (!r) throw new HttpError(404, "Request not found.");
    if (r.status !== "PENDING") throw new HttpError(409, "This request was already decided.");
    const acl = await Acl.load(db);
    assertPerm(acl.folderPerms(u, r.resource_id), "manage", "this folder");
    const perms = input.perms?.length ? input.perms : r.requested_perms;
    if (input.decision === "APPROVED") {
      await db.query(
        `INSERT INTO permissions (resource_type, resource_id, principal_type, principal_value, perms, granted_by)
         VALUES ('folder',$1,'user',$2,$3,$4)
         ON CONFLICT (resource_type, resource_id, principal_type, principal_value)
         DO UPDATE SET perms = ARRAY(SELECT DISTINCT unnest(permissions.perms || EXCLUDED.perms)), granted_by = EXCLUDED.granted_by, granted_at = now()`,
        [r.resource_id, String(r.requested_by), perms, u.id],
      );
    }
    await db.query(
      "UPDATE access_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
      [id, input.decision, u.id, input.note || null],
    );
    const requester = await one<{ employee_id: string; full_name: string }>("SELECT employee_id, full_name FROM users WHERE id = $1", [r.requested_by], db);
    await writeAudit(db, actor, {
      action: input.decision === "APPROVED" ? "ACCESS_GRANTED" : "ACCESS_REJECTED",
      entityType: "folder",
      entityId: r.resource_id,
      entityName: acl.folders.get(r.resource_id)?.name,
      reason: input.note || null,
      details: { requestId: id, user: `${requester?.full_name} (${requester?.employee_id})`, perms },
    });
  });
  return json({ ok: true });
});
