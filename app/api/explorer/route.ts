import { isAdmin, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { Acl, permList } from "@/lib/permissions";

// Lists a folder's contents (or the root), like a Windows Explorer pane.
export const GET = route(async (req) => {
  const u = await requireUser();
  const param = new URL(req.url).searchParams.get("folder");
  const folderId = param && param !== "root" ? Number(param) : null;
  const acl = await Acl.load();

  let current: { id: number | null; name: string; perms: string[] } = {
    id: null,
    name: "SheetVault",
    perms: isAdmin(u) ? ["read", "create", "manage"] : ["read"],
  };
  let path: { id: number; name: string }[] = [];
  if (folderId !== null) {
    if (!acl.exists(folderId)) throw new HttpError(404, "This folder no longer exists.");
    const perms = acl.folderPerms(u, folderId);
    path = acl.path(folderId).map((f) => ({ id: f.id, name: f.name }));
    if (!perms.has("read")) {
      return json({ denied: true, folder: { id: folderId, name: acl.folders.get(folderId)!.name }, path }, 403);
    }
    current = { id: folderId, name: acl.folders.get(folderId)!.name, perms: permList(perms) };
  }

  const folders = await q<{ id: number; name: string; updated_at: Date; created_at: Date; owner: string | null; items: number }>(
    `SELECT f.id, f.name, f.updated_at, f.created_at, u.full_name AS owner,
            (SELECT count(*)::int FROM folders c WHERE c.parent_id = f.id AND c.deleted_at IS NULL)
          + (SELECT count(*)::int FROM files x WHERE x.folder_id = f.id AND x.deleted_at IS NULL) AS items
     FROM folders f LEFT JOIN users u ON u.id = f.created_by
     WHERE f.deleted_at IS NULL AND f.parent_id IS NOT DISTINCT FROM $1
     ORDER BY lower(f.name)`,
    [folderId],
  );

  const files = folderId === null ? [] : await q<{
    id: number; folder_id: number; name: string; status: string; current_version: number; size_bytes: number;
    updated_at: Date; created_at: Date; owner_id: number; owner: string; inherit_permissions: boolean;
    open_annotations: number; reviewer: string | null;
  }>(
    `SELECT f.id, f.folder_id, f.name, f.status, f.current_version, f.size_bytes, f.updated_at, f.created_at, f.owner_id,
            u.full_name AS owner, f.inherit_permissions,
            (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status <> 'CLOSED') AS open_annotations,
            (SELECT ru.full_name FROM reviews r JOIN users ru ON ru.id = r.reviewer_id
              WHERE r.file_id = f.id AND r.decision IS NULL ORDER BY r.id DESC LIMIT 1) AS reviewer
     FROM files f JOIN users u ON u.id = f.owner_id
     WHERE f.folder_id = $1 AND f.deleted_at IS NULL
     ORDER BY lower(f.name)`,
    [folderId],
  );
  await acl.loadFileAces(files.map((f) => f.id));

  return json({
    folder: current,
    path,
    folders: folders.map((f) => {
      const p = acl.folderPerms(u, f.id);
      return { ...f, perms: permList(p), locked: !p.has("read") };
    }),
    files: files.map((f) => {
      const p = acl.filePerms(u, f);
      return { ...f, perms: permList(p), locked: !p.has("read") };
    }),
  });
});
