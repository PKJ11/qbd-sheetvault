import "server-only";
import { PERM_KEYS, type Perm } from "./constants";
import { q, type Db } from "./db";
import { HttpError } from "./http";
import type { User } from "./auth";

export interface FolderRow {
  id: number;
  parent_id: number | null;
  name: string;
  inherit_permissions: boolean;
}

export interface Ace {
  id: number;
  resource_type: "folder" | "file";
  resource_id: number;
  principal_type: "user" | "role" | "department" | "everyone";
  principal_value: string;
  perms: Perm[];
}

export interface FileAclInfo {
  id: number;
  folder_id: number;
  owner_id: number;
  inherit_permissions: boolean;
}

type Principal = Pick<User, "id" | "roles" | "department">;

export function aceMatches(ace: Ace, u: Principal): boolean {
  switch (ace.principal_type) {
    case "everyone":
      return true;
    case "user":
      return ace.principal_value === String(u.id);
    case "role":
      return u.roles.includes(ace.principal_value);
    case "department":
      return !!u.department && ace.principal_value.toLowerCase() === u.department.toLowerCase();
  }
}

function expand(perms: Iterable<Perm>): Set<Perm> {
  const s = new Set(perms);
  if (s.has("manage")) return new Set(PERM_KEYS); // Full control implies everything
  if (s.size && !s.has("read")) s.add("read"); // any right needs read to be usable
  return s;
}

/**
 * Access-control snapshot for one request: all live folders + their ACEs, evaluated in memory.
 * Folder grants inherit down the tree until a folder/file with inheritance disabled.
 */
export class Acl {
  readonly folders = new Map<number, FolderRow>();
  private folderAces = new Map<number, Ace[]>();
  private fileAces = new Map<number, Ace[]>();

  private constructor() {}

  /** One round trip: all live folders, all folder ACEs, and the ACEs of the given files. */
  static async load(db?: Db, fileIds: number[] = []): Promise<Acl> {
    const acl = new Acl();
    const [row] = await q<{ folders: FolderRow[] | null; aces: Ace[] | null; file_aces: Ace[] | null }>(
      `SELECT
         (SELECT json_agg(json_build_object('id', id, 'parent_id', parent_id, 'name', name, 'inherit_permissions', inherit_permissions))
            FROM folders WHERE deleted_at IS NULL) AS folders,
         (SELECT json_agg(p) FROM permissions p WHERE resource_type = 'folder') AS aces,
         (SELECT json_agg(p) FROM permissions p WHERE resource_type = 'file' AND resource_id = ANY($1::int[])) AS file_aces`,
      [fileIds],
      db,
    );
    for (const f of row.folders ?? []) acl.folders.set(f.id, f);
    for (const a of row.aces ?? []) acl.folderAces.set(a.resource_id, [...(acl.folderAces.get(a.resource_id) ?? []), a]);
    for (const id of fileIds) acl.fileAces.set(id, []);
    for (const a of row.file_aces ?? []) acl.fileAces.get(a.resource_id)!.push(a);
    return acl;
  }

  async loadFileAces(fileIds: number[], db?: Db) {
    const missing = fileIds.filter((id) => !this.fileAces.has(id));
    if (!missing.length) return;
    for (const id of missing) this.fileAces.set(id, []);
    const rows = await q<Ace>(
      "SELECT * FROM permissions WHERE resource_type = 'file' AND resource_id = ANY($1::int[])",
      [missing],
      db,
    );
    for (const a of rows) this.fileAces.get(a.resource_id)!.push(a);
  }

  /** Folder chain from root to the folder (inclusive). Empty if the folder (or an ancestor) is deleted. */
  path(folderId: number): FolderRow[] {
    const out: FolderRow[] = [];
    let cur = this.folders.get(folderId);
    const seen = new Set<number>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur);
      if (cur.parent_id === null) return out;
      cur = this.folders.get(cur.parent_id);
    }
    return cur ? out : [];
  }

  exists(folderId: number) {
    return this.path(folderId).length > 0;
  }

  folderPerms(u: User, folderId: number): Set<Perm> {
    if (!this.exists(folderId)) return new Set();
    if (u.roles.includes("ADMIN")) return new Set(PERM_KEYS);
    const out = new Set<Perm>();
    let cur = this.folders.get(folderId);
    while (cur) {
      for (const a of this.folderAces.get(cur.id) ?? []) if (aceMatches(a, u)) a.perms.forEach((p) => out.add(p));
      if (!cur.inherit_permissions || cur.parent_id === null) break;
      cur = this.folders.get(cur.parent_id);
    }
    return expand(out);
  }

  /** Requires loadFileAces([file.id]) beforehand. */
  filePerms(u: User, file: FileAclInfo): Set<Perm> {
    if (!this.exists(file.folder_id)) return new Set();
    if (u.roles.includes("ADMIN")) return new Set(PERM_KEYS);
    const out = new Set<Perm>();
    for (const a of this.fileAces.get(file.id) ?? []) if (aceMatches(a, u)) a.perms.forEach((p) => out.add(p));
    if (file.inherit_permissions) this.folderPerms(u, file.folder_id).forEach((p) => out.add(p));
    if (file.owner_id === u.id) {
      out.add("read");
      out.add("edit");
    }
    return expand(out);
  }

  folderAcesOf(folderId: number) {
    return this.folderAces.get(folderId) ?? [];
  }

  fileAcesOf(fileId: number) {
    return this.fileAces.get(fileId) ?? [];
  }

  /** Aces inherited by a folder from its ancestors (for the Security tab). */
  inheritedFolderAces(folderId: number): (Ace & { from: string })[] {
    const out: (Ace & { from: string })[] = [];
    let cur = this.folders.get(folderId);
    if (!cur || !cur.inherit_permissions) return out;
    cur = cur.parent_id !== null ? this.folders.get(cur.parent_id) : undefined;
    while (cur) {
      for (const a of this.folderAces.get(cur.id) ?? []) out.push({ ...a, from: cur.name });
      if (!cur.inherit_permissions || cur.parent_id === null) break;
      cur = this.folders.get(cur.parent_id);
    }
    return out;
  }

  inheritedFileAces(file: FileAclInfo): (Ace & { from: string })[] {
    if (!file.inherit_permissions) return [];
    const f = this.folders.get(file.folder_id);
    if (!f) return [];
    return [...this.folderAcesOf(f.id).map((a) => ({ ...a, from: f.name })), ...this.inheritedFolderAces(f.id)];
  }
}

export function assertPerm(perms: Set<Perm>, p: Perm, what = "this item") {
  if (!perms.has(p)) {
    const label = p === "read" ? "open" : p === "manage" ? "change permissions on" : p;
    throw new HttpError(403, `Access denied. You don't have permission to ${label} ${what}.`);
  }
}

export function permList(s: Set<Perm>): Perm[] {
  return PERM_KEYS.filter((p) => s.has(p));
}
