import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, isAdmin, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { cleanName } from "@/lib/files";
import { body, HttpError, json, route } from "@/lib/http";
import { Acl, assertPerm } from "@/lib/permissions";

const Input = z.object({ parentId: z.number().int().positive().nullable(), name: z.string() });

export const POST = route(async (req) => {
  const u = await requireUser();
  const { parentId, name: raw } = Input.parse(await body(req));
  const name = cleanName(raw, "Folder name");
  const acl = await Acl.load();
  if (parentId === null) {
    if (!isAdmin(u)) throw new HttpError(403, "Only administrators can create top-level folders.");
  } else {
    assertPerm(acl.folderPerms(u, parentId), "create", "folders here");
  }
  const actor = await actorOf(u);
  const folder = await tx(async (db) => {
    const r = await db.query<{ id: number }>(
      "INSERT INTO folders (parent_id, name, created_by) VALUES ($1,$2,$3) RETURNING id",
      [parentId, name, u.id],
    );
    if (parentId !== null) await db.query("UPDATE folders SET updated_at = now() WHERE id = $1", [parentId]);
    await writeAudit(db, actor, {
      action: "FOLDER_CREATED",
      entityType: "folder",
      entityId: r.rows[0].id,
      entityName: name,
      details: { parent: parentId === null ? "(root)" : acl.path(parentId).map((f) => f.name).join(" \\ ") },
    });
    return r.rows[0];
  });
  return json({ id: folder.id }, 201);
});
