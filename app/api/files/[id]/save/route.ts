import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { applyEdits, EditError } from "@/lib/excel/write";
import { cellText, fileAccess, requireReason, storeVersion, versionContent } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const Input = z.object({
  baseVersion: z.number().int().positive(),
  reason: z.string(),
  edits: z
    .array(
      z.object({
        sheet: z.string(),
        cell: z.string().regex(/^[A-Z]{1,3}\d{1,7}$/),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    )
    .min(1)
    .max(5000),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  const reason = requireReason(input.reason, "A reason for change");
  const actor = await actorOf(u);

  const result = await tx(async (db) => {
    const { file } = await fileAccess(u, id, "edit", db, true);
    if (file.status === "IN_REVIEW") throw new HttpError(409, "This file is locked while it is under review.");
    if (file.status === "APPROVED") throw new HttpError(409, "Approved files are read-only. Start a new revision to make changes.");
    if (input.baseVersion !== file.current_version)
      throw new HttpError(409, `Someone saved a newer version (v${file.current_version}) while you were editing. Reload to continue.`);

    const buf = await versionContent(id, file.current_version, db);
    let out;
    try {
      out = await applyEdits(buf, input.edits);
    } catch (e) {
      if (e instanceof EditError) throw new HttpError(400, e.message);
      throw e;
    }
    if (!out.changes.length) return { version: file.current_version, changes: 0 };

    const next = file.current_version + 1;
    await storeVersion(db, id, next, out.buffer, out.model, u.id, reason);
    await db.query(
      `INSERT INTO cell_changes (file_id, version_no, sheet, cell, old_value, new_value, reason, changed_by)
       SELECT $1, $2, s, c, o, n, $7, $8 FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS t(s, c, o, n)`,
      [
        id,
        next,
        out.changes.map((c) => c.sheet),
        out.changes.map((c) => c.cell),
        out.changes.map((c) => cellText(c.old)),
        out.changes.map((c) => cellText(c.new)),
        reason,
        u.id,
      ],
    );
    await db.query(
      "UPDATE files SET current_version = $2, size_bytes = $3, updated_at = now(), updated_by = $4 WHERE id = $1",
      [id, next, out.buffer.length, u.id],
    );
    await writeAudit(db, actor, {
      action: "FILE_EDITED",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason,
      details: {
        fromVersion: file.current_version,
        toVersion: next,
        changes: out.changes.map((c) => ({ cell: `${c.sheet}!${c.cell}`, old: c.old, new: c.new })),
      },
    });
    return { version: next, changes: out.changes.length };
  });
  return json(result);
});
