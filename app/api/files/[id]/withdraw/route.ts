import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { fileAccess, requireReason } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// The submitter pulls a file back out of review (e.g. wrong reviewer or a late correction).
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { reason: raw } = (await body<{ reason?: string }>(req)) ?? {};
  const reason = requireReason(raw, "A reason for withdrawal");
  const actor = await actorOf(u);
  await tx(async (db) => {
    const { file } = await fileAccess(u, id, "edit", db, true);
    if (file.status !== "IN_REVIEW") throw new HttpError(409, "This file is not under review.");
    const review = await one<{ id: number; submitted_by: number; cycle_no: number }>(
      "SELECT id, submitted_by, cycle_no FROM reviews WHERE file_id = $1 AND decision IS NULL ORDER BY id DESC LIMIT 1",
      [id],
      db,
    );
    if (!review) throw new HttpError(409, "No active review found.");
    if (review.submitted_by !== u.id && file.owner_id !== u.id) throw new HttpError(403, "Only the submitter can withdraw this review.");
    // Back to the state before submission: requested changes if annotations exist, otherwise draft.
    const prior = await one<{ n: number }>("SELECT count(*)::int AS n FROM annotations WHERE file_id = $1 AND status <> 'CLOSED'", [id], db);
    const status = prior!.n > 0 ? "CHANGES_REQUESTED" : "DRAFT";
    await db.query("UPDATE reviews SET decision = 'WITHDRAWN', decided_at = now(), decision_comment = $2 WHERE id = $1", [review.id, reason]);
    await db.query("UPDATE files SET status = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [id, status, u.id]);
    await writeAudit(db, actor, {
      action: "REVIEW_WITHDRAWN",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason,
      details: { cycle: review.cycle_no, statusFrom: "IN_REVIEW", statusTo: status },
    });
  });
  return json({ ok: true });
});
