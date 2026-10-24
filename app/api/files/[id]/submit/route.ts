import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { fileAccess, verifyESignature } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { eligibleReviewers } from "@/lib/workflow";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({ reviewerId: z.number().int().positive(), comment: z.string().max(2000).optional(), password: z.string() });

export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  await verifyESignature(u, input.password, id);
  const actor = await actorOf(u);

  const out = await tx(async (db) => {
    const { file, acl } = await fileAccess(u, id, "edit", db, true);
    if (file.status !== "DRAFT" && file.status !== "CHANGES_REQUESTED")
      throw new HttpError(409, "Only draft files or files with requested changes can be submitted.");
    const open = await one<{ n: number }>("SELECT count(*)::int AS n FROM annotations WHERE file_id = $1 AND status = 'OPEN'", [id], db);
    if (open!.n > 0)
      throw new HttpError(409, `Respond to all ${open!.n} open annotation(s) before resubmitting.`);
    const reviewers = await eligibleReviewers(acl, file, [u.id, file.owner_id], db);
    const reviewer = reviewers.find((r) => r.id === input.reviewerId);
    if (!reviewer) throw new HttpError(400, "The selected reviewer doesn't have Review permission on this file.");

    const cycle = file.review_cycle + 1;
    const r = await db.query<{ id: number }>(
      `INSERT INTO reviews (file_id, cycle_no, version_no, submitted_by, submit_comment, reviewer_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, cycle, file.current_version, u.id, input.comment?.trim() || null, reviewer.id],
    );
    await db.query("UPDATE files SET status = 'IN_REVIEW', review_cycle = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [id, cycle, u.id]);
    await writeAudit(db, actor, {
      action: file.status === "CHANGES_REQUESTED" ? "FILE_RESUBMITTED" : "FILE_SUBMITTED_FOR_REVIEW",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason: input.comment?.trim() || null,
      details: {
        reviewer: `${reviewer.full_name} (${reviewer.employee_id})`,
        version: file.current_version,
        cycle,
        statusFrom: file.status,
        statusTo: "IN_REVIEW",
        eSignature: `${u.full_name} (${u.employee_id}) - meaning: submitted for review`,
      },
    });
    return { reviewId: r.rows[0].id };
  });
  return json(out);
});
