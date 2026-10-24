import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";

// Approved workbooks the caller can read — offered as templates for "New > Excel sheet from template".
export const GET = route(async () => {
  const u = await requireUser();
  const rows = await q<{ id: number; folder_id: number; name: string; owner_id: number; inherit_permissions: boolean; current_version: number; updated_at: Date }>(
    `SELECT id, folder_id, name, owner_id, inherit_permissions, current_version, updated_at
     FROM files WHERE status = 'APPROVED' AND deleted_at IS NULL ORDER BY lower(name)`,
  );
  const acl = await Acl.load();
  await acl.loadFileAces(rows.map((r) => r.id));
  return json({
    templates: rows
      .filter((r) => acl.filePerms(u, r).has("read"))
      .map((r) => ({ id: r.id, name: r.name, version: r.current_version, updated_at: r.updated_at, path: acl.path(r.folder_id).map((f) => f.name).join(" \\ ") })),
  });
});
