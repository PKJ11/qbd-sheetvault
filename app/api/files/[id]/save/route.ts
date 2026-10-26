import { z } from "zod";
import { actorOf, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { applyEdits, EditError } from "@/lib/excel/write";
import { fileAccess, requireReason, versionContent } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { activeSession } from "@/lib/sessions";
import { commitVersion } from "@/lib/versions";

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
    const session = await activeSession(id, db);
    if (session) throw new HttpError(409, `This file is checked out in the Excel editor by ${session.user_name}. Check it in or discard first.`);

    const buf = await versionContent(id, file.current_version, db);
    let out;
    try {
      out = await applyEdits(buf, input.edits);
    } catch (e) {
      if (e instanceof EditError) throw new HttpError(400, e.message);
      throw e;
    }
    if (!out.changes.length) return { version: file.current_version, changes: 0 };
    const version = await commitVersion(db, actor, file, { buffer: out.buffer, model: out.model, changes: out.changes, reason, source: "grid" });
    return { version, changes: out.changes.length };
  });
  return json(result);
});
