import { requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";

// Navigation-pane tree. Children of folders the user can't open are not revealed.
export const GET = route(async () => {
  const u = await requireUser();
  const acl = await Acl.load();
  const nodes = [...acl.folders.values()]
    .filter((f) => {
      if (f.parent_id === null) return true;
      return acl.folderPerms(u, f.parent_id).has("read") && acl.exists(f.id);
    })
    .map((f) => ({ id: f.id, parent_id: f.parent_id, name: f.name, locked: !acl.folderPerms(u, f.id).has("read") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return json({ nodes });
});
