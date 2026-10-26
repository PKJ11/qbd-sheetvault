import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { tx } from "@/lib/db";
import { fileAccess } from "@/lib/files";
import { HttpError, intParam, json, route } from "@/lib/http";
import { newDocKey, onlyofficeSettings } from "@/lib/onlyoffice";
import { activeSession } from "@/lib/sessions";

type Ctx = { params: Promise<{ id: string }> };

// Check the workbook out for editing in the ONLYOFFICE editor. One editor at a time, so every change is attributable.
export const POST = route<Ctx>(async (_req, { params }) => {
  if (!onlyofficeSettings()) throw new HttpError(501, "The Excel editor (ONLYOFFICE) is not configured on this server.");
  const u = await requireUser();
  const id = intParam((await params).id);
  const actor = await actorOf(u);
  const session = await tx(async (db) => {
    const { file } = await fileAccess(u, id, "edit", db, true);
    if (file.status !== "DRAFT" && file.status !== "CHANGES_REQUESTED")
      throw new HttpError(409, file.status === "IN_REVIEW" ? "This file is locked while it is under review." : "Approved files are read-only. Start a new revision to make changes.");
    const existing = await activeSession(id, db, true);
    if (existing) {
      if (existing.user_id === u.id) return { id: existing.id, resumed: true };
      throw new HttpError(409, `Already checked out by ${existing.user_name} (${existing.employee_id}) since ${existing.started_at.toISOString().slice(0, 16).replace("T", " ")} UTC.`);
    }
    const r = await db.query<{ id: number }>(
      "INSERT INTO edit_sessions (file_id, user_id, base_version, doc_key) VALUES ($1,$2,$3,$4) RETURNING id",
      [id, u.id, file.current_version, newDocKey(`sv${id}v${file.current_version}`)],
    );
    await writeAudit(db, actor, {
      action: "FILE_CHECKED_OUT",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      details: { editSession: r.rows[0].id, baseVersion: file.current_version, editor: "ONLYOFFICE" },
    });
    return { id: r.rows[0].id, resumed: false };
  });
  return json(session);
});
