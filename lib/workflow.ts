import "server-only";
import { writeAudit, type Actor } from "./audit";
import { USER_COLUMNS, type User } from "./auth";
import { QA_DEPARTMENT, type Perm, type ReviewStage } from "./constants";
import { one, q, type Db } from "./db";
import { storeVersion, uniqueFileName, versionContent, type FileRow } from "./files";
import { HttpError } from "./http";
import type { Acl } from "./permissions";

/*
 * Approval workflow
 *
 *   DRAFT / CHANGES_REQUESTED --submit--> IN_REVIEW   (stage MANAGER: one manager of the author's department)
 *   IN_REVIEW  --approve--> QA_REVIEW                 (stage QA: anyone in the QA department)
 *   IN_REVIEW  --request changes--> CHANGES_REQUESTED
 *   QA_REVIEW  --request changes--> CHANGES_REQUESTED (the author fixes it and it goes through the manager again)
 *   QA_REVIEW  --approve--> APPROVED                  (final; read-only for good, a copy is filed under Quality Assurance)
 */

export interface ActiveReview {
  id: number;
  reviewer_id: number | null;
  submitted_by: number;
  cycle_no: number;
  version_no: number;
  stage: ReviewStage;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export const isQaMember = (u: Pick<User, "roles" | "department">) => u.roles.includes("QA") || norm(u.department) === norm(QA_DEPARTMENT);

export const isUnderReview = (status: FileRow["status"]) => status === "IN_REVIEW" || status === "QA_REVIEW";

export async function activeReview(fileId: number, db?: Db, forUpdate = false): Promise<ActiveReview | null> {
  return one<ActiveReview>(
    `SELECT id, reviewer_id, submitted_by, cycle_no, version_no, stage FROM reviews
     WHERE file_id = $1 AND decision IS NULL ORDER BY id DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [fileId],
    db,
  );
}

/** Why `u` may not act on the active review (annotate, close, request changes, approve), or null if they may. */
export function reviewBlocker(u: User, file: Pick<FileRow, "owner_id">, review: ActiveReview | null, perms: Set<Perm>): string | null {
  if (!review) return "This file is not awaiting review.";
  if (!perms.has("review")) return "You don't have Review permission on this file.";
  if (review.stage === "MANAGER")
    return review.reviewer_id === u.id ? null : "Only the assigned manager of the author's department can review this file now.";
  if (!isQaMember(u)) return "This file is waiting for QA approval. Only members of the QA department can review it now.";
  if (u.id === file.owner_id || u.id === review.submitted_by) return "You can't give the QA approval for your own work.";
  return null;
}

export function assertCanReview(u: User, file: Pick<FileRow, "owner_id">, review: ActiveReview | null, perms: Set<Perm>): ActiveReview {
  const why = reviewBlocker(u, file, review, perms);
  if (why) throw new HttpError(review ? 403 : 409, why);
  return review!;
}

/**
 * Managers of the author's department who may do the first approval: active, MANAGER role,
 * same department as the file's author, Review permission on the file, and not in `exclude`.
 */
export async function departmentManagers(acl: Acl, file: FileRow, exclude: number[], db?: Db) {
  const owner = await one<{ department: string | null }>("SELECT department FROM users WHERE id = $1", [file.owner_id], db);
  const department = owner?.department?.trim() || null;
  if (!department) return { department, managers: [] as User[] };
  const users = await q<User>(
    `SELECT ${USER_COLUMNS} FROM users
     WHERE is_active AND locked_at IS NULL AND 'MANAGER' = ANY(roles) AND lower(trim(department)) = lower($1)
     ORDER BY full_name`,
    [department],
    db,
  );
  await acl.loadFileAces([file.id], db);
  return { department, managers: users.filter((x) => !exclude.includes(x.id) && acl.filePerms(x, file).has("review")) };
}

/**
 * Record a reviewer's decision on the active review (caller has checked status, permission and the e-signature).
 *   Manager stage: approve -> QA_REVIEW (a QA-stage review is opened); request changes -> back to the author.
 *   QA stage:      approve -> APPROVED for good + copy filed under Quality Assurance; request changes -> back to the author.
 */
export async function recordDecision(
  db: Db,
  actor: Actor,
  u: Pick<User, "id" | "employee_id" | "full_name">,
  acl: Acl,
  file: FileRow,
  review: ActiveReview,
  decision: "APPROVED" | "CHANGES_REQUESTED",
  comment: string | null,
) {
  const isQa = review.stage === "QA";
  const counts = await one<{ open: number; addressed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'ADDRESSED')::int AS addressed
     FROM annotations WHERE file_id = $1`,
    [file.id],
    db,
  );
  let closed = 0;
  if (decision === "CHANGES_REQUESTED") {
    if (!counts!.open) throw new HttpError(400, "Add at least one annotation (or re-open one) describing the change required.");
  } else {
    if (counts!.open) throw new HttpError(400, `Close or delete the ${counts!.open} open annotation(s) before approving.`);
    // The manager closes what was raised at the manager stage. Annotations QA raised stay for QA to verify.
    const r = await db.query(
      `UPDATE annotations a SET status = 'CLOSED', closed_by = $2, closed_at = now()
       WHERE a.file_id = $1 AND a.status = 'ADDRESSED'
         AND ($3 OR NOT EXISTS (SELECT 1 FROM reviews r WHERE r.id = a.review_id AND r.stage = 'QA'))`,
      [file.id, u.id, isQa],
    );
    closed = r.rowCount ?? 0;
  }
  await db.query("UPDATE reviews SET decision = $2, decided_at = now(), decision_comment = $3, reviewer_id = $4 WHERE id = $1", [
    review.id,
    decision,
    comment,
    u.id,
  ]);

  const sendToQa = decision === "APPROVED" && !isQa;
  const status: FileRow["status"] = decision === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED" : sendToQa ? "QA_REVIEW" : "APPROVED";
  if (sendToQa) {
    await db.query(
      `INSERT INTO reviews (file_id, cycle_no, version_no, submitted_by, submit_comment, reviewer_id, stage)
       VALUES ($1,$2,$3,$4,$5,NULL,'QA')`,
      [file.id, review.cycle_no, file.current_version, u.id, comment],
    );
  }
  await db.query("UPDATE files SET status = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [file.id, status, u.id]);

  const meaning =
    decision === "CHANGES_REQUESTED"
      ? `${isQa ? "QA" : "manager"} review, changes requested`
      : isQa
        ? "QA reviewed and approved (final)"
        : "manager reviewed and approved, sent to QA";
  await writeAudit(db, actor, {
    action: decision === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED" : isQa ? "FILE_APPROVED" : "MANAGER_APPROVED_SENT_TO_QA",
    entityType: "file",
    entityId: file.id,
    entityName: file.name,
    reason: comment,
    details: {
      stage: isQa ? "QA department" : "Department manager",
      version: file.current_version,
      cycle: review.cycle_no,
      statusFrom: file.status,
      statusTo: status,
      openAnnotations: counts!.open,
      ...(closed ? { annotationsClosedOnApproval: closed } : {}),
      eSignature: `${u.full_name} (${u.employee_id}) - meaning: ${meaning}`,
    },
  });

  const qaCopy = status === "APPROVED" ? await fileQaCopy(db, actor, acl, file) : null;
  if (qaCopy)
    await writeAudit(db, actor, {
      action: "FILE_FILED_TO_QA",
      entityType: "file",
      entityId: file.id,
      entityName: file.name,
      details: { qaCopyId: qaCopy.id, qaCopy: `${qaCopy.path} \\ ${qaCopy.name}`, version: file.current_version },
    });
  return { status, qaCopy };
}

/**
 * After the final QA approval: file a read-only copy of the approved version under the Quality Assurance
 * folder, at the same path the original has (folders are created as needed). Runs in the caller's transaction.
 * Returns null when the workbook already lives inside the QA folder.
 */
export async function fileQaCopy(db: Db, actor: Actor, acl: Acl, file: FileRow) {
  const qaRoot = acl.systemFolder("QA");
  if (!qaRoot) throw new HttpError(500, "The Quality Assurance folder is missing. Ask an administrator to run the database migration.");
  if (acl.isWithin(file.folder_id, "QA")) return null;

  const srcPath = acl.path(file.folder_id);
  let parent = qaRoot.id;
  const names = [qaRoot.name];
  for (const seg of srcPath) {
    names.push(seg.name);
    const existing = await one<{ id: number }>(
      "SELECT id FROM folders WHERE parent_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL",
      [parent, seg.name],
      db,
    );
    if (existing) {
      parent = existing.id;
      continue;
    }
    const r = await db.query<{ id: number }>("INSERT INTO folders (parent_id, name, created_by) VALUES ($1,$2,$3) RETURNING id", [parent, seg.name, actor.id]);
    parent = r.rows[0].id;
    await writeAudit(db, actor, {
      action: "FOLDER_CREATED",
      entityType: "folder",
      entityId: parent,
      entityName: seg.name,
      reason: "Created automatically to file a QA-approved workbook",
      details: { parent: names.slice(0, -1).join(" \\ ") },
    });
  }

  const buf = await versionContent(file.id, file.current_version, db);
  const v = await one<{ model: unknown; sha256: string }>(
    "SELECT model, sha256 FROM file_versions WHERE file_id = $1 AND version_no = $2",
    [file.id, file.current_version],
    db,
  );
  const name = await uniqueFileName(db, parent, file.name);
  const sourcePath = `${acl.pathText(file.folder_id)} \\ ${file.name}`;
  const r = await db.query<{ id: number }>(
    `INSERT INTO files (folder_id, name, owner_id, status, review_cycle, size_bytes, updated_by, source_file_id)
     VALUES ($1,$2,$3,'APPROVED',$4,$5,$6,$7) RETURNING id`,
    [parent, name, file.owner_id, file.review_cycle, buf.length, actor.id, file.id],
  );
  const copyId = r.rows[0].id;
  await storeVersion(db, copyId, 1, buf, v!.model as never, actor.id!, `QA-approved copy of "${sourcePath}" v${file.current_version}`);
  await db.query("UPDATE folders SET updated_at = now() WHERE id = $1", [parent]);
  const path = names.join(" \\ ");
  await writeAudit(db, actor, {
    action: "FILE_QA_COPY_CREATED",
    entityType: "file",
    entityId: copyId,
    entityName: name,
    details: { source: sourcePath, sourceFileId: file.id, sourceVersion: file.current_version, sha256: v!.sha256, filedIn: path },
  });
  return { id: copyId, name, path };
}
