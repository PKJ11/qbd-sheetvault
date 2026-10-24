import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { parseWorkbook } from "@/lib/excel/parse";
import { cleanName, MAX_UPLOAD_BYTES, sha256, storeVersion, uniqueFileName } from "@/lib/files";
import { HttpError, intParam, json, route } from "@/lib/http";
import { Acl, assertPerm } from "@/lib/permissions";

export const POST = route(async (req) => {
  const u = await requireUser();
  const form = await req.formData();
  const folderId = intParam(String(form.get("folderId")), "folder");
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file was uploaded.");
  const name = cleanName(file.name, "File name");
  if (!/\.xlsx$/i.test(name)) throw new HttpError(400, "Only Excel workbooks (.xlsx) can be uploaded.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File is larger than the 4 MB limit.");

  const acl = await Acl.load();
  assertPerm(acl.folderPerms(u, folderId), "upload", "upload files to this folder");

  const buf = Buffer.from(await file.arrayBuffer());
  let model;
  try {
    model = await parseWorkbook(buf);
  } catch {
    throw new HttpError(400, "The file could not be read as an Excel workbook.");
  }
  if (!model.sheets.length) throw new HttpError(400, "The workbook has no visible sheets.");

  const actor = await actorOf(u);
  const created = await tx(async (db) => {
    const finalName = await uniqueFileName(db, folderId, name);
    const r = await db.query<{ id: number }>(
      `INSERT INTO files (folder_id, name, owner_id, size_bytes, updated_by) VALUES ($1,$2,$3,$4,$3) RETURNING id`,
      [folderId, finalName, u.id, buf.length],
    );
    const id = r.rows[0].id;
    await storeVersion(db, id, 1, buf, model, u.id, "Initial upload");
    await db.query("UPDATE folders SET updated_at = now() WHERE id = $1", [folderId]);
    await writeAudit(db, actor, {
      action: "FILE_UPLOADED",
      entityType: "file",
      entityId: id,
      entityName: finalName,
      details: {
        folder: acl.path(folderId).map((f) => f.name).join(" \\ "),
        size: buf.length,
        sha256: sha256(buf),
        sheets: model.sheets.map((s) => s.name),
        version: 1,
      },
    });
    return { id, name: finalName };
  });
  return json(created, 201);
});
