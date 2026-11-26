import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";

// Validated templates offered for "New > Excel sheet from template": approved workbooks inside the
// Quality Control \ Validated Templates folder (and its sub-folders) that the caller can read. Nothing else.
export const GET = route(async () => {
  const u = await requireUser();
  const acl = await Acl.load();
  const lib = acl.systemFolder("TEMPLATES");
  if (!lib) return json({ templates: [], library: null });
  const libIds = [...acl.folders.values()].filter((f) => acl.isWithin(f.id, "TEMPLATES")).map((f) => f.id);
  const rows = await q<{ id: number; folder_id: number; name: string; owner_id: number; inherit_permissions: boolean; current_version: number; updated_at: Date }>(
    `SELECT id, folder_id, name, owner_id, inherit_permissions, current_version, updated_at
     FROM files WHERE status = 'APPROVED' AND deleted_at IS NULL AND folder_id = ANY($1::int[]) ORDER BY lower(name)`,
    [libIds],
  );
  await acl.loadFileAces(rows.map((r) => r.id));
  return json({
    library: acl.pathText(lib.id),
    templates: rows
      .filter((r) => acl.filePerms(u, r).has("read"))
      .map((r) => ({ id: r.id, name: r.name, version: r.current_version, updated_at: r.updated_at, path: acl.pathText(r.folder_id) })),
  });
});
