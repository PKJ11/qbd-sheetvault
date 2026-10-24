import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { fileAccess, verifyESignature } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  comment: z.string().max(2000).optional(),
  password: z.string(),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  await verifyESignature(u, input.password, id);
  const actor = await actorOf(u);

  await tx(async (db) => {
    const { file } = await fileAccess(u, id, "review", db, true);
    if (file.status !== "IN_REVIEW") throw new HttpError(409, "This file is not awaiting review.");
    const review = await one<{ id: number; reviewer_id: number; cycle_no: number }>(
      "SELECT id, reviewer_id, cycle_no FROM reviews WHERE file_id = $1 AND decision IS NULL ORDER BY id DESC LIMIT 1",
      [id],
      db,
    );
    if (!review) throw new HttpError(409, "No active review found.");
    if (review.reviewer_id !== u.id) throw new HttpError(403, "Only the assigned reviewer can complete this review.");

    const counts = await one<{ open: number; addressed: number }>(
      `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'ADDRESSED')::int AS addressed
       FROM annotations WHERE file_id = $1`,
      [id],
      db,
    );
    let closed = 0;
    if (input.decision === "CHANGES_REQUESTED") {
      if (!counts!.open) throw new HttpError(400, "Add at least one annotation (or re-open one) describing the change required.");
    } else {
      if (counts!.open) throw new HttpError(400, `Close or delete the ${counts!.open} open annotation(s) before approving.`);
      const r = await db.query(
        "UPDATE annotations SET status = 'CLOSED', closed_by = $2, closed_at = now() WHERE file_id = $1 AND status = 'ADDRESSED'",
        [id, u.id],
      );
      closed = r.rowCount ?? 0;
    }
    await db.query(
      "UPDATE reviews SET decision = $2, decided_at = now(), decision_comment = $3 WHERE id = $1",
      [review.id, input.decision, input.comment?.trim() || null],
    );
    await db.query("UPDATE files SET status = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [id, input.decision, u.id]);
    await writeAudit(db, actor, {
      action: input.decision === "APPROVED" ? "FILE_APPROVED" : "CHANGES_REQUESTED",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason: input.comment?.trim() || null,
      details: {
        version: file.current_version,
        cycle: review.cycle_no,
        statusFrom: "IN_REVIEW",
        statusTo: input.decision,
        openAnnotations: counts!.open,
        ...(closed ? { annotationsClosedOnApproval: closed } : {}),
        eSignature: `${u.full_name} (${u.employee_id}) - meaning: ${input.decision === "APPROVED" ? "reviewed and approved" : "reviewed, changes requested"}`,
      },
    });
  });
  return json({ ok: true });
});
