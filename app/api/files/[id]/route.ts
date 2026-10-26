import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { q, tx } from "@/lib/db";
import { cleanName, fileAccess, requireReason, versionModel } from "@/lib/files";
import { body, HttpError, intParam, json, route } from "@/lib/http";
import { permList } from "@/lib/permissions";
import { onlyofficeSettings } from "@/lib/onlyoffice";
import { activeSession } from "@/lib/sessions";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { file, perms, acl } = await fileAccess(u, id, "read");
  const vParam = new URL(req.url).searchParams.get("v");
  const versionNo = vParam ? intParam(vParam, "version") : file.current_version;

  // Everything except the (cached) model in a single round trip.
  type Meta = {
    version: { created_at: Date; reason: string | null; by: string; sha256: string } | null;
    versions: unknown[] | null;
    annotations: unknown[] | null;
    messages: unknown[] | null;
    reviews: { decision: string | null; reviewer_id: number; version_no: number }[] | null;
    owner: { full_name: string; employee_id: string } | null;
    last_reviewed: number | null;
    checkout: { id: number; user_id: number; user_name: string; employee_id: string; started_at: string; working_saved_at: string | null; base_version: number } | null;
    changed: unknown[] | null;
  };
  const [[meta], model] = await Promise.all([
    q<Meta>(
      `WITH lr AS (
         SELECT max(version_no) AS v FROM reviews WHERE file_id = $1 AND decision IN ('APPROVED','CHANGES_REQUESTED')
       )
       SELECT
         (SELECT json_build_object('created_at', v.created_at, 'reason', v.reason, 'sha256', v.sha256, 'by', u.full_name)
            FROM file_versions v JOIN users u ON u.id = v.created_by WHERE v.file_id = $1 AND v.version_no = $2) AS version,
         (SELECT json_agg(x ORDER BY x.version_no DESC) FROM (
            SELECT v.version_no, v.created_at, v.reason, v.size_bytes, v.sha256, u.full_name AS by, u.employee_id
            FROM file_versions v JOIN users u ON u.id = v.created_by WHERE v.file_id = $1) x) AS versions,
         (SELECT json_agg(x ORDER BY x.id) FROM (
            SELECT a.*, cu.full_name AS created_by_name, ru.full_name AS responded_by_name, xu.full_name AS closed_by_name
            FROM annotations a JOIN users cu ON cu.id = a.created_by
            LEFT JOIN users ru ON ru.id = a.responded_by LEFT JOIN users xu ON xu.id = a.closed_by
            WHERE a.file_id = $1) x) AS annotations,
         (SELECT json_agg(x ORDER BY x.id) FROM (
            SELECT m.*, u.full_name AS by_name, u.employee_id AS by_employee_id
            FROM annotation_messages m JOIN annotations a ON a.id = m.annotation_id JOIN users u ON u.id = m.created_by
            WHERE a.file_id = $1) x) AS messages,
         (SELECT json_agg(x ORDER BY x.id DESC) FROM (
            SELECT r.*, su.full_name AS submitted_by_name, ru.full_name AS reviewer_name, ru.employee_id AS reviewer_employee_id
            FROM reviews r JOIN users su ON su.id = r.submitted_by JOIN users ru ON ru.id = r.reviewer_id
            WHERE r.file_id = $1) x) AS reviews,
         (SELECT json_build_object('full_name', full_name, 'employee_id', employee_id) FROM users WHERE id = $3) AS owner,
         (SELECT v FROM lr) AS last_reviewed,
         (SELECT json_build_object('id', s.id, 'user_id', s.user_id, 'user_name', u.full_name, 'employee_id', u.employee_id,
                                   'started_at', s.started_at, 'working_saved_at', s.working_saved_at, 'base_version', s.base_version)
            FROM edit_sessions s JOIN users u ON u.id = s.user_id WHERE s.file_id = $1 AND s.status = 'ACTIVE') AS checkout,
         -- Cells changed since the version the last completed review looked at.
         (SELECT json_agg(x) FROM (
            SELECT DISTINCT ON (sheet, cell) sheet, cell, old_value, new_value, version_no
            FROM cell_changes WHERE file_id = $1 AND version_no > (SELECT v FROM lr) AND version_no <= $2
            ORDER BY sheet, cell, version_no DESC) x) AS changed`,
      [id, versionNo, file.owner_id],
    ),
    versionModel(id, versionNo),
  ]);
  if (!meta.version || !model) throw new HttpError(404, "Version not found.");
  const version = meta.version;
  const reviews = meta.reviews ?? [];
  const owner = meta.owner;

  const activeReview = reviews.find((r) => r.decision === null) ?? null;
  return json({
    file: { ...file, owner_name: owner?.full_name, owner_employee_id: owner?.employee_id },
    path: acl.path(file.folder_id).map((f) => ({ id: f.id, name: f.name })),
    perms: permList(perms),
    isOwner: file.owner_id === u.id,
    isReviewer: !!activeReview && activeReview.reviewer_id === u.id,
    versionNo,
    version: { created_at: version.created_at, reason: version.reason, by: version.by, sha256: version.sha256 },
    model,
    versions: meta.versions ?? [],
    annotations: meta.annotations ?? [],
    messages: meta.messages ?? [],
    reviews,
    activeReview,
    changedSinceReview: meta.changed ?? [],
    lastReviewedVersion: meta.last_reviewed,
    checkout: meta.checkout ? { ...meta.checkout, mine: meta.checkout.user_id === u.id } : null,
    editorAvailable: !!onlyofficeSettings(),
  });
});

const Patch = z.object({ name: z.string(), reason: z.string().optional() });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const input = Patch.parse(await body(req));
  const { file } = await fileAccess(u, id, "edit");
  let name = cleanName(input.name, "File name");
  if (!/\.xlsx$/i.test(name)) name += ".xlsx";
  if (name === file.name) return json({ ok: true });
  const actor = await actorOf(u);
  await tx(async (db) => {
    await db.query("UPDATE files SET name = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [id, name, u.id]);
    await writeAudit(db, actor, { action: "FILE_RENAMED", entityType: "file", entityId: id, entityName: name, reason: input.reason ?? null, details: { from: file.name, to: name } });
  });
  return json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { reason: raw } = (await body<{ reason?: string }>(req)) ?? {};
  const reason = requireReason(raw, "A reason for deletion");
  const { file, acl } = await fileAccess(u, id, "delete");
  if (file.status === "IN_REVIEW") throw new HttpError(409, "This file is under review. Withdraw or complete the review before deleting it.");
  const checkout = await activeSession(id);
  if (checkout) throw new HttpError(409, `This file is checked out in the Excel editor by ${checkout.user_name}.`);
  const actor = await actorOf(u);
  await tx(async (db) => {
    await db.query("UPDATE files SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [id, u.id]);
    await writeAudit(db, actor, {
      action: "FILE_DELETED",
      entityType: "file",
      entityId: id,
      entityName: file.name,
      reason,
      details: { folder: acl.path(file.folder_id).map((f) => f.name).join(" \\ "), status: file.status, version: file.current_version },
    });
  });
  return json({ ok: true });
});
