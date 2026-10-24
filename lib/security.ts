import "server-only";
import { z } from "zod";
import { writeAudit } from "./audit";
import { actorOf, type User } from "./auth";
import { PERM_KEYS, PRINCIPAL_TYPES, ROLES } from "./constants";
import { q, tx } from "./db";
import { getFile } from "./files";
import { HttpError } from "./http";
import { Acl, assertPerm, permList, type Ace } from "./permissions";

export const AcesInput = z.object({
  inherit: z.boolean(),
  aces: z
    .array(
      z.object({
        principal_type: z.enum(PRINCIPAL_TYPES),
        principal_value: z.string().max(200),
        perms: z.array(z.enum(PERM_KEYS as [string, ...string[]])),
      }),
    )
    .max(200),
  reason: z.string().optional(),
});

async function principalLabels(aces: Pick<Ace, "principal_type" | "principal_value">[]) {
  const ids = aces.filter((a) => a.principal_type === "user").map((a) => Number(a.principal_value));
  const users = ids.length
    ? await q<{ id: number; employee_id: string; full_name: string }>(
        "SELECT id, employee_id, full_name FROM users WHERE id = ANY($1::int[])",
        [ids],
      )
    : [];
  const byId = new Map(users.map((x) => [String(x.id), `${x.full_name} (${x.employee_id})`]));
  return (a: Pick<Ace, "principal_type" | "principal_value">) => {
    switch (a.principal_type) {
      case "everyone":
        return "Everyone";
      case "user":
        return byId.get(a.principal_value) ?? `User #${a.principal_value}`;
      case "role":
        return `Role: ${ROLES[a.principal_value as keyof typeof ROLES] ?? a.principal_value}`;
      case "department":
        return `Department: ${a.principal_value}`;
    }
  };
}

export async function getSecurity(u: User, type: "folder" | "file", id: number) {
  const acl = await Acl.load();
  let explicit: Ace[], inherited: (Ace & { from: string })[], inherit: boolean, myPerms;
  if (type === "folder") {
    if (!acl.exists(id)) throw new HttpError(404, "Folder not found.");
    myPerms = acl.folderPerms(u, id);
    explicit = acl.folderAcesOf(id);
    inherited = acl.inheritedFolderAces(id);
    inherit = acl.folders.get(id)!.inherit_permissions;
  } else {
    const file = await getFile(id);
    await acl.loadFileAces([id]);
    myPerms = acl.filePerms(u, file);
    explicit = acl.fileAcesOf(id);
    inherited = acl.inheritedFileAces(file);
    inherit = file.inherit_permissions;
  }
  assertPerm(myPerms, "read");
  const label = await principalLabels([...explicit, ...inherited]);
  return {
    inherit,
    canManage: myPerms.has("manage"),
    myPerms: permList(myPerms),
    explicit: explicit.map((a) => ({ ...a, label: label(a) })),
    inherited: inherited.map((a) => ({ ...a, label: label(a) })),
  };
}

export async function putSecurity(u: User, type: "folder" | "file", id: number, input: z.infer<typeof AcesInput>) {
  const acl = await Acl.load();
  let name: string;
  if (type === "folder") {
    if (!acl.exists(id)) throw new HttpError(404, "Folder not found.");
    assertPerm(acl.folderPerms(u, id), "manage", "this folder");
    name = acl.folders.get(id)!.name;
  } else {
    const file = await getFile(id);
    await acl.loadFileAces([id]);
    assertPerm(acl.filePerms(u, file), "manage", `"${file.name}"`);
    name = file.name;
  }
  const before = type === "folder" ? acl.folderAcesOf(id) : acl.fileAcesOf(id);
  const beforeInherit = type === "folder" ? acl.folders.get(id)!.inherit_permissions : (await getFile(id)).inherit_permissions;

  // Normalise + merge duplicates
  const merged = new Map<string, { principal_type: string; principal_value: string; perms: Set<string> }>();
  for (const a of input.aces) {
    const value = a.principal_type === "everyone" ? "" : a.principal_value.trim();
    if (a.principal_type !== "everyone" && !value) throw new HttpError(400, "Each entry needs a user, role or department.");
    const key = `${a.principal_type}:${value.toLowerCase()}`;
    const cur = merged.get(key) ?? { principal_type: a.principal_type, principal_value: value, perms: new Set<string>() };
    a.perms.forEach((p) => cur.perms.add(p));
    merged.set(key, cur);
  }
  const after = [...merged.values()].filter((a) => a.perms.size > 0);

  const fmt = (a: { principal_type: string; principal_value: string; perms: Iterable<string> }) =>
    `${a.principal_type}:${a.principal_value}=${[...a.perms].sort().join("+")}`;
  const beforeSet = new Set(before.map(fmt));
  const afterSet = new Set(after.map(fmt));
  const added = [...afterSet].filter((x) => !beforeSet.has(x));
  const removed = [...beforeSet].filter((x) => !afterSet.has(x));
  if (!added.length && !removed.length && beforeInherit === input.inherit) return { changed: false };

  const actor = await actorOf(u);
  await tx(async (db) => {
    await db.query("DELETE FROM permissions WHERE resource_type = $1 AND resource_id = $2", [type, id]);
    for (const a of after) {
      await db.query(
        `INSERT INTO permissions (resource_type, resource_id, principal_type, principal_value, perms, granted_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [type, id, a.principal_type, a.principal_value, PERM_KEYS.filter((p) => a.perms.has(p)), u.id],
      );
    }
    await db.query(`UPDATE ${type === "folder" ? "folders" : "files"} SET inherit_permissions = $2, updated_at = now() WHERE id = $1`, [id, input.inherit]);
    await writeAudit(db, actor, {
      action: "PERMISSIONS_CHANGED",
      entityType: type,
      entityId: id,
      entityName: name,
      reason: input.reason?.trim() || null,
      details: {
        added,
        removed,
        ...(beforeInherit !== input.inherit ? { inheritance: `${beforeInherit ? "on" : "off"} -> ${input.inherit ? "on" : "off"}` } : {}),
      },
    });
  });
  return { changed: true };
}
