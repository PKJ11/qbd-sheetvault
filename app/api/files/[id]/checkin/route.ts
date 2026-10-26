import { audit, writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { diffWorkbooks } from "@/lib/excel/diff";
import { parseWorkbook } from "@/lib/excel/parse";
import { fileAccess, requireReason, sha256, versionModel } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { commandForcesave } from "@/lib/onlyoffice";
import { activeSession } from "@/lib/sessions";
import { commitVersion } from "@/lib/versions";

type Ctx = { params: Promise<{ id: string }> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Check in: pull the latest content from the open editor, verify the template was respected, create a version.
export const POST = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { reason: raw } = (await body<{ reason?: string }>(req)) ?? {};
  const reason = requireReason(raw, "A reason for change");
  const actor = await actorOf(u);

  const session = await activeSession(id);
  if (!session || session.user_id !== u.id) throw new HttpError(409, "You don't have this file checked out.");

  // Ask the editor to save now and wait for the callback to deliver the file.
  const requestedAt = Date.now();
  const cmd = await commandForcesave(session.doc_key).catch(() => -1);
  if (cmd === 0) {
    for (let i = 0; i < 40; i++) {
      const s = await one<{ working_saved_at: Date | null }>("SELECT working_saved_at FROM edit_sessions WHERE id = $1", [session.id]);
      if (s?.working_saved_at && s.working_saved_at.getTime() >= requestedAt - 1000) break;
      if (i === 39) throw new HttpError(504, "The editor did not deliver the file in time. Wait a moment and check in again.");
      await sleep(500);
    }
  }

  const result = await tx<{ violations?: string[]; version?: number; changes?: number }>(async (db) => {
    const { file } = await fileAccess(u, id, "edit", db, true);
    const s = await one<{ id: number; base_version: number; working_content: Buffer | null; working_sha256: string | null; status: string }>(
      "SELECT id, base_version, working_content, working_sha256, status FROM edit_sessions WHERE id = $1 FOR UPDATE",
      [session.id],
      db,
    );
    if (!s || s.status !== "ACTIVE") throw new HttpError(409, "This editing session has already ended.");
    if (!s.working_content) throw new HttpError(400, "No changes were made in the editor. Use Discard to release the file.");
    if (sha256(s.working_content) !== s.working_sha256) throw new HttpError(500, "Working copy integrity check failed.");
    if (file.current_version !== s.base_version)
      throw new HttpError(409, `The file changed (now v${file.current_version}) since it was checked out from v${s.base_version}.`);

    const before = await versionModel(id, s.base_version);
    let after;
    try {
      after = await parseWorkbook(s.working_content);
    } catch {
      throw new HttpError(400, "The edited file could not be read as an Excel workbook.");
    }
    const diff = diffWorkbooks(before!, after);
    if (diff.violations.length) return { violations: diff.violations };

    const version = await commitVersion(db, actor, file, {
      buffer: s.working_content,
      model: after,
      changes: diff.changes,
      reason,
      source: "editor",
      sessionId: s.id,
    });
    await db.query("UPDATE edit_sessions SET status = 'CHECKED_IN', ended_at = now(), ended_by = $2 WHERE id = $1", [s.id, u.id]);
    await writeAudit(db, actor, { action: "FILE_CHECKED_IN", entityType: "file", entityId: id, entityName: file.name, reason, details: { editSession: s.id, version, cellChanges: diff.changes.length } });
    return { version, changes: diff.changes.length };
  });

  if (result.violations) {
    const v = result.violations;
    await audit(actor, { action: "CHECKIN_REJECTED_INTEGRITY", entityType: "file", entityId: id, reason, details: { editSession: session.id, violations: v.slice(0, 50) } });
    throw new HttpError(422, `Check-in blocked — the validated template was altered: ${v.slice(0, 5).join("; ")}${v.length > 5 ? ` (+${v.length - 5} more)` : ""}. Undo these changes in the editor or discard.`);
  }
  return json(result);
});
