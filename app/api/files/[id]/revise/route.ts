import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { fileAccess, requireReason } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// Re-open an approved file as a draft for a new revision. History and approvals are kept.
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { reason: raw } = (await body<{ reason?: string }>(req)) ?? {};
  const reason = requireReason(raw, "A reason for revision");
  const actor = await actorOf(u);
  await tx(async (db) => {
    const { file } = await fileAccess(u, id, "edit", db, true);
    if (file.status !== "APPROVED") throw new HttpError(409, "Only approved files can be revised.");
    await db.query("UPDATE files SET status = 'DRAFT', updated_at = now(), updated_by = $2 WHERE id = $1", [id, u.id]);
    await writeAudit(db, actor, {
      action: "REVISION_STARTED",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason,
      details: { approvedVersion: file.current_version, statusFrom: "APPROVED", statusTo: "DRAFT" },
    });
  });
  return json({ ok: true });
});
