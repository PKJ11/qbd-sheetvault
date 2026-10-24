import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { cleanName, fileAccess, storeVersion, uniqueFileName, versionContent } from "@/lib/files";
import { body, intParam, json, route } from "@/lib/http";
import { assertPerm } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({ folderId: z.number().int().positive(), name: z.string().optional() });

// "New from template": copy the latest version of a file into a folder as a new draft owned by the caller.
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Input.parse(await body(req));
  const { file: src, acl } = await fileAccess(u, id, "read");
  assertPerm(acl.folderPerms(u, input.folderId), "create", "create files in this folder");
  let name = cleanName(input.name || src.name, "File name");
  if (!/\.xlsx$/i.test(name)) name += ".xlsx";
  const buf = await versionContent(src.id, src.current_version);
  const v = await one<{ model: unknown }>("SELECT model FROM file_versions WHERE file_id = $1 AND version_no = $2", [src.id, src.current_version]);
  const actor = await actorOf(u);
  const created = await tx(async (db) => {
    const finalName = await uniqueFileName(db, input.folderId, name);
    const r = await db.query<{ id: number }>(
      `INSERT INTO files (folder_id, name, owner_id, size_bytes, updated_by) VALUES ($1,$2,$3,$4,$3) RETURNING id`,
      [input.folderId, finalName, u.id, buf.length],
    );
    const newId = r.rows[0].id;
    await storeVersion(db, newId, 1, buf, v!.model as never, u.id, `Created from template "${src.name}" v${src.current_version}`);
    await db.query("UPDATE folders SET updated_at = now() WHERE id = $1", [input.folderId]);
    await writeAudit(db, actor, {
      action: "FILE_CREATED_FROM_TEMPLATE",
      entityType: "file",
      entityId: newId,
      entityName: finalName,
      details: {
        template: src.name,
        templateId: src.id,
        templateVersion: src.current_version,
        folder: acl.path(input.folderId).map((f) => f.name).join(" \\ "),
      },
    });
    return { id: newId, name: finalName };
  });
  return json(created, 201);
});
