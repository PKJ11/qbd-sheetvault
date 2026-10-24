import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { fileAccess } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  await fileAccess(u, id, "read");
  const messages = await q(
    `SELECT m.*, u.full_name AS by_name, u.employee_id AS by_employee_id
     FROM annotation_messages m JOIN annotations a ON a.id = m.annotation_id JOIN users u ON u.id = m.created_by
     WHERE a.file_id = $1 ORDER BY m.id`,
    [id],
  );
  return json({ messages });
});

const Input = z.object({
  sheet: z.string().nullable().optional(),
  cell: z.string().regex(/^[A-Z]{1,3}\d{1,7}$/).nullable().optional(),
  comment: z.string().trim().min(2).max(4000),
});

// Reviewer adds an annotation (optionally pinned to a cell) during an active review.
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  const actor = await actorOf(u);
  const created = await tx(async (db) => {
    const { file } = await fileAccess(u, id, "review", db, true);
    if (file.status !== "IN_REVIEW") throw new HttpError(409, "Annotations can only be added while the file is under review.");
    const review = await one<{ id: number; reviewer_id: number }>(
      "SELECT id, reviewer_id FROM reviews WHERE file_id = $1 AND decision IS NULL ORDER BY id DESC LIMIT 1",
      [id],
      db,
    );
    if (!review || review.reviewer_id !== u.id) throw new HttpError(403, "Only the assigned reviewer can annotate this file.");
    const r = await db.query<{ id: number }>(
      `INSERT INTO annotations (file_id, review_id, version_no, sheet, cell, comment, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [id, review.id, file.current_version, input.sheet ?? null, input.cell ?? null, input.comment, u.id],
    );
    await db.query(
      "INSERT INTO annotation_messages (annotation_id, kind, text, version_no, created_by) VALUES ($1,'COMMENT',$2,$3,$4)",
      [r.rows[0].id, input.comment, file.current_version, u.id],
    );
    await writeAudit(db, actor, {
      action: "ANNOTATION_ADDED",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      details: { annotationId: r.rows[0].id, cell: input.cell ? `${input.sheet}!${input.cell}` : "(general)", comment: input.comment, version: file.current_version },
    });
    return { id: r.rows[0].id };
  });
  return json(created, 201);
});
