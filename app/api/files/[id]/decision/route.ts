import { z } from "zod";
import { actorOf, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { fileAccess, verifyESignature } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { activeReview, assertCanReview, isUnderReview, recordDecision } from "@/lib/workflow";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  comment: z.string().max(2000).optional(),
  password: z.string(),
});

/*
 * Manager stage:  approve -> the workbook goes to the QA department (QA_REVIEW); request changes -> back to the author.
 * QA stage:       approve -> APPROVED for good + a copy is filed under Quality Assurance; request changes -> back to the
 *                 author, who resubmits to the department manager again.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  await verifyESignature(u, input.password, id);
  const actor = await actorOf(u);
  const comment = input.comment?.trim() || null;

  const out = await tx(async (db) => {
    const { file, perms, acl } = await fileAccess(u, id, "read", db, true);
    if (!isUnderReview(file.status)) throw new HttpError(409, "This file is not awaiting review.");
    const review = assertCanReview(u, file, await activeReview(id, db, true), perms);
    return recordDecision(db, actor, u, acl, file, review, input.decision, comment);
  });
  return json(out);
});
