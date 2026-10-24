import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireAdmin } from "@/lib/auth";
import { one, q, tx } from "@/lib/db";
import { requireReason } from "@/lib/files";
import { body, HttpError, json, route } from "@/lib/http";

// Deleted items are soft-deleted (GxP: records are never destroyed). Admins can restore them.
export const GET = route(async () => {
  await requireAdmin();
  const [folders, files] = await Promise.all([
    q(
      `SELECT f.id, f.name, f.deleted_at, u.full_name AS deleted_by_name, p.name AS parent_name
       FROM folders f LEFT JOIN users u ON u.id = f.deleted_by LEFT JOIN folders p ON p.id = f.parent_id
       WHERE f.deleted_at IS NOT NULL ORDER BY f.deleted_at DESC`,
    ),
    q(
      `SELECT x.id, x.name, x.deleted_at, x.status, x.current_version, u.full_name AS deleted_by_name, p.name AS parent_name,
              p.deleted_at IS NOT NULL AS parent_deleted
       FROM files x LEFT JOIN users u ON u.id = x.deleted_by JOIN folders p ON p.id = x.folder_id
       WHERE x.deleted_at IS NOT NULL ORDER BY x.deleted_at DESC`,
    ),
  ]);
  return json({ folders, files });
});

const Input = z.object({ type: z.enum(["folder", "file"]), id: z.number().int().positive(), reason: z.string() });

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const input = Input.parse(await body(req));
  const reason = requireReason(input.reason, "A reason for restoring");
  const actor = await actorOf(admin);
  await tx(async (db) => {
    if (input.type === "file") {
      const f = await one<{ name: string; folder_id: number; deleted_at: Date | null }>("SELECT name, folder_id, deleted_at FROM files WHERE id = $1", [input.id], db);
      if (!f?.deleted_at) throw new HttpError(404, "Item is not in the recycle bin.");
      const parent = await one<{ deleted_at: Date | null }>("SELECT deleted_at FROM folders WHERE id = $1", [f.folder_id], db);
      if (parent?.deleted_at) throw new HttpError(409, "Restore its folder first.");
      const clash = await one("SELECT 1 FROM files WHERE folder_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL", [f.folder_id, f.name], db);
      if (clash) throw new HttpError(409, "A file with the same name now exists in that folder. Rename it first.");
      await db.query("UPDATE files SET deleted_at = NULL, deleted_by = NULL WHERE id = $1", [input.id]);
      await writeAudit(db, actor, { action: "FILE_RESTORED", entityType: "file", entityId: input.id, entityName: f.name, reason });
    } else {
      const f = await one<{ name: string; parent_id: number | null; deleted_at: Date | null }>("SELECT name, parent_id, deleted_at FROM folders WHERE id = $1", [input.id], db);
      if (!f?.deleted_at) throw new HttpError(404, "Item is not in the recycle bin.");
      if (f.parent_id !== null) {
        const parent = await one<{ deleted_at: Date | null }>("SELECT deleted_at FROM folders WHERE id = $1", [f.parent_id], db);
        if (parent?.deleted_at) throw new HttpError(409, "Restore its parent folder first.");
      }
      // Files deleted together with this folder (same transaction timestamp) come back too.
      const r = await db.query(
        `WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION ALL SELECT c.id FROM folders c JOIN tree t ON c.parent_id = t.id WHERE c.deleted_at IS NULL)
         UPDATE files SET deleted_at = NULL, deleted_by = NULL WHERE folder_id IN (SELECT id FROM tree) AND deleted_at = $2`,
        [input.id, f.deleted_at],
      );
      await db.query("UPDATE folders SET deleted_at = NULL, deleted_by = NULL WHERE id = $1", [input.id]);
      await writeAudit(db, actor, { action: "FOLDER_RESTORED", entityType: "folder", entityId: input.id, entityName: f.name, reason, details: { filesRestored: r.rowCount } });
    }
  });
  return json({ ok: true });
});
