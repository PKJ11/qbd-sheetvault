import { writeAudit } from "@/lib/audit";
import { actorOf, isAdmin, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { getFile } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { activeSession } from "@/lib/sessions";

type Ctx = { params: Promise<{ id: string }> };

// Release a check-out without creating a version. The holder can discard; an admin can release someone else's.
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { reason } = (await body<{ reason?: string }>(req)) ?? {};
  const actor = await actorOf(u);
  await tx(async (db) => {
    const file = await getFile(id, db);
    const s = await activeSession(id, db, true);
    if (!s) throw new HttpError(409, "This file is not checked out.");
    if (s.user_id !== u.id && !isAdmin(u)) throw new HttpError(403, `Only ${s.user_name} or an administrator can release this check-out.`);
    if (s.user_id !== u.id && (!reason || reason.trim().length < 3)) throw new HttpError(400, "A reason is required to release someone else's check-out.");
    await db.query("UPDATE edit_sessions SET status = 'DISCARDED', ended_at = now(), ended_by = $2 WHERE id = $1", [s.id, u.id]);
    await writeAudit(db, actor, {
      action: s.user_id === u.id ? "CHECKOUT_DISCARDED" : "CHECKOUT_RELEASED_BY_ADMIN",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason: reason?.trim() || null,
      details: { editSession: s.id, holder: `${s.user_name} (${s.employee_id})`, hadUnsavedWork: !!s.working_saved_at },
    });
  });
  return json({ ok: true });
});
