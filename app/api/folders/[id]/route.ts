import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { cleanName, requireReason } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { Acl, assertPerm, permList } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const acl = await Acl.load();
  if (!acl.exists(id)) throw new HttpError(404, "Folder not found.");
  const perms = acl.folderPerms(u, id);
  const info = await one(
    `SELECT f.id, f.name, f.created_at, f.updated_at, f.inherit_permissions, u.full_name AS created_by_name,
            (SELECT count(*)::int FROM folders c WHERE c.parent_id = f.id AND c.deleted_at IS NULL) AS folders,
            (SELECT count(*)::int FROM files x WHERE x.folder_id = f.id AND x.deleted_at IS NULL) AS files,
            (SELECT coalesce(sum(size_bytes),0)::int FROM files x WHERE x.folder_id = f.id AND x.deleted_at IS NULL) AS size
     FROM folders f LEFT JOIN users u ON u.id = f.created_by WHERE f.id = $1`,
    [id],
  );
  return json({
    ...info,
    location: acl.path(id).slice(0, -1).map((f) => f.name).join(" \\ ") || "SheetVault",
    perms: permList(perms),
  });
});

const Patch = z.object({ name: z.string() });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { name: raw } = Patch.parse(await body(req));
  const name = cleanName(raw, "Folder name");
  const acl = await Acl.load();
  assertPerm(acl.folderPerms(u, id), "edit", "rename this folder");
  const old = acl.folders.get(id)!.name;
  const actor = await actorOf(u);
  await tx(async (db) => {
    await db.query("UPDATE folders SET name = $2, updated_at = now() WHERE id = $1", [id, name]);
    await writeAudit(db, actor, { action: "FOLDER_RENAMED", entityType: "folder", entityId: id, entityName: name, details: { from: old, to: name } });
  });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { reason: rawReason } = (await body<{ reason?: string }>(req)) ?? {};
  const reason = requireReason(rawReason, "A reason for deletion");
  const acl = await Acl.load();
  assertPerm(acl.folderPerms(u, id), "delete", "delete this folder");
  // Every sub-folder must be deletable by this user too.
  const descendants = [...acl.folders.values()].filter((f) => acl.path(f.id).some((p) => p.id === id));
  for (const d of descendants) assertPerm(acl.folderPerms(u, d.id), "delete", `delete "${d.name}"`);
  const ids = descendants.map((d) => d.id);
  const actor = await actorOf(u);
  const counts = await tx(async (db) => {
    const files = await db.query(
      "UPDATE files SET deleted_at = now(), deleted_by = $2 WHERE folder_id = ANY($1::int[]) AND deleted_at IS NULL RETURNING id",
      [ids, u.id],
    );
    // Only the top folder is flagged; descendants vanish with it and come back on restore.
    await db.query("UPDATE folders SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [id, u.id]);
    await writeAudit(db, actor, {
      action: "FOLDER_DELETED",
      entityType: "folder",
      entityId: id,
      entityName: acl.folders.get(id)!.name,
      reason,
      details: { subfolders: ids.length - 1, files: files.rowCount, path: acl.path(id).map((f) => f.name).join(" \\ ") },
    });
    return { files: files.rowCount };
  });
  return json({ ok: true, ...counts });
});
