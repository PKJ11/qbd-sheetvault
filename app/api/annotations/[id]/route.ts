import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { fileAccess } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

interface AnnotationRow {
  id: number;
  file_id: number;
  review_id: number | null;
  sheet: string | null;
  cell: string | null;
  comment: string;
  status: "OPEN" | "ADDRESSED" | "CLOSED";
  created_by: number;
}

const Input = z.object({
  action: z.enum(["respond", "close", "reopen"]),
  text: z.string().trim().max(4000).optional(),
});

async function activeReview(fileId: number, db: Parameters<typeof one>[2]) {
  return one<{ id: number; reviewer_id: number }>(
    "SELECT id, reviewer_id FROM reviews WHERE file_id = $1 AND decision IS NULL ORDER BY id DESC LIMIT 1",
    [fileId],
    db,
  );
}

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const annId = intParam((await params).id);
  const input = Input.parse(await body(req));
  const actor = await actorOf(u);

  await tx(async (db) => {
    const a = await one<AnnotationRow>("SELECT * FROM annotations WHERE id = $1 FOR UPDATE", [annId], db);
    if (!a) throw new HttpError(404, "Annotation not found.");
    let next: AnnotationRow["status"];
    let kind: "RESPONSE" | "CLOSE" | "REOPEN";
    const { file } = await fileAccess(u, a.file_id, input.action === "respond" ? "edit" : "review", db);

    if (input.action === "respond") {
      if (file.status !== "CHANGES_REQUESTED" && file.status !== "DRAFT")
        throw new HttpError(409, "You can respond to annotations once the reviewer has requested changes.");
      if (a.status === "CLOSED") throw new HttpError(409, "This annotation is already closed.");
      if (!input.text || input.text.length < 2) throw new HttpError(400, "Describe how the annotation was addressed.");
      next = "ADDRESSED";
      kind = "RESPONSE";
      await db.query(
        "UPDATE annotations SET status = 'ADDRESSED', response = $2, responded_by = $3, responded_at = now() WHERE id = $1",
        [annId, input.text, u.id],
      );
    } else {
      if (file.status !== "IN_REVIEW") throw new HttpError(409, "Annotations can be closed or re-opened only during a review.");
      const review = await activeReview(a.file_id, db);
      if (!review || review.reviewer_id !== u.id) throw new HttpError(403, "Only the assigned reviewer can do this.");
      if (input.action === "close") {
        if (a.status === "CLOSED") throw new HttpError(409, "Already closed.");
        next = "CLOSED";
        kind = "CLOSE";
        await db.query("UPDATE annotations SET status = 'CLOSED', closed_by = $2, closed_at = now() WHERE id = $1", [annId, u.id]);
      } else {
        if (a.status === "OPEN") throw new HttpError(409, "Already open.");
        if (!input.text || input.text.length < 2) throw new HttpError(400, "Explain why the annotation is re-opened.");
        next = "OPEN";
        kind = "REOPEN";
        await db.query("UPDATE annotations SET status = 'OPEN', closed_by = NULL, closed_at = NULL, review_id = $2 WHERE id = $1", [annId, review.id]);
      }
    }
    await db.query(
      "INSERT INTO annotation_messages (annotation_id, kind, text, version_no, created_by) VALUES ($1,$2,$3,$4,$5)",
      [annId, kind, input.text || null, file.current_version, u.id],
    );
    await writeAudit(db, actor, {
      action: `ANNOTATION_${kind === "RESPONSE" ? "RESPONDED" : kind === "CLOSE" ? "CLOSED" : "REOPENED"}`,
      entityType: "file",
      entityId: a.file_id,
      entityName: file.name,
      details: {
        annotationId: annId,
        cell: a.cell ? `${a.sheet}!${a.cell}` : "(general)",
        statusFrom: a.status,
        statusTo: next,
        ...(input.text ? { text: input.text } : {}),
        version: file.current_version,
      },
    });
  });
  return json({ ok: true });
});

// The reviewer may withdraw an annotation they added in the current review.
export const DELETE = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const annId = intParam((await params).id);
  const actor = await actorOf(u);
  await tx(async (db) => {
    const a = await one<AnnotationRow>("SELECT * FROM annotations WHERE id = $1 FOR UPDATE", [annId], db);
    if (!a) throw new HttpError(404, "Annotation not found.");
    const { file } = await fileAccess(u, a.file_id, "review", db);
    const review = await activeReview(a.file_id, db);
    if (file.status !== "IN_REVIEW" || !review || review.reviewer_id !== u.id || a.review_id !== review.id || a.created_by !== u.id || a.status !== "OPEN")
      throw new HttpError(409, "Only open annotations you added in the current review can be deleted.");
    await db.query("DELETE FROM annotations WHERE id = $1", [annId]);
    await writeAudit(db, actor, {
      action: "ANNOTATION_DELETED",
      entityType: "file",
      entityId: a.file_id,
      entityName: file.name,
      details: { annotationId: annId, cell: a.cell ? `${a.sheet}!${a.cell}` : "(general)", comment: a.comment },
    });
  });
  return json({ ok: true });
});
