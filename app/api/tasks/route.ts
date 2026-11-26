import { isAdmin, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";
import { isQaMember } from "@/lib/workflow";

const FILE_COLS = `f.id, f.name, f.status, f.current_version, f.review_cycle, f.updated_at, f.folder_id, f.owner_id, f.inherit_permissions,
  (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'OPEN') AS open_annotations,
  (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'ADDRESSED') AS addressed_annotations`;

type TaskRow = { id: number; folder_id: number; owner_id: number; inherit_permissions: boolean; stage?: string; reviewer_id?: number | null };

export const GET = route(async () => {
  const u = await requireUser();
  const acl = await Acl.load();
  const qa = isQaMember(u);

  const [toReview, changesRequested, inReview, drafts, myRequests, pendingRequests] = await Promise.all([
    // Manager stage: assigned to me. QA stage: the shared QA queue (not my own work).
    q<TaskRow>(
      `SELECT ${FILE_COLS}, r.stage, r.reviewer_id, r.submitted_at, r.submit_comment, r.cycle_no, su.full_name AS submitted_by_name
       FROM reviews r JOIN files f ON f.id = r.file_id JOIN users su ON su.id = r.submitted_by
       WHERE r.decision IS NULL AND f.deleted_at IS NULL
         AND (r.reviewer_id = $1 OR ($2 AND r.stage = 'QA' AND f.owner_id <> $1 AND r.submitted_by <> $1))
       ORDER BY r.submitted_at`,
      [u.id, qa],
    ),
    q<TaskRow>(
      `SELECT ${FILE_COLS}, r.stage, r.decided_at, r.decision_comment, ru.full_name AS reviewer_name
       FROM files f
       LEFT JOIN LATERAL (SELECT * FROM reviews r WHERE r.file_id = f.id AND r.decision = 'CHANGES_REQUESTED' ORDER BY r.id DESC LIMIT 1) r ON TRUE
       LEFT JOIN users ru ON ru.id = r.reviewer_id
       WHERE f.owner_id = $1 AND f.status = 'CHANGES_REQUESTED' AND f.deleted_at IS NULL ORDER BY f.updated_at DESC`,
      [u.id],
    ),
    q<TaskRow>(
      `SELECT ${FILE_COLS}, r.stage, r.submitted_at, COALESCE(ru.full_name, 'QA department') AS reviewer_name
       FROM files f JOIN reviews r ON r.file_id = f.id AND r.decision IS NULL LEFT JOIN users ru ON ru.id = r.reviewer_id
       WHERE f.owner_id = $1 AND f.status IN ('IN_REVIEW','QA_REVIEW') AND f.deleted_at IS NULL ORDER BY r.submitted_at DESC`,
      [u.id],
    ),
    q<TaskRow>(
      `SELECT ${FILE_COLS} FROM files f WHERE f.owner_id = $1 AND f.status = 'DRAFT' AND f.deleted_at IS NULL ORDER BY f.updated_at DESC LIMIT 50`,
      [u.id],
    ),
    q(
      `SELECT ar.*, du.full_name AS decided_by_name FROM access_requests ar LEFT JOIN users du ON du.id = ar.decided_by
       WHERE ar.requested_by = $1 ORDER BY ar.id DESC LIMIT 20`,
      [u.id],
    ),
    isAdmin(u)
      ? q("SELECT count(*)::int AS n FROM access_requests WHERE status = 'PENDING'")
      : Promise.resolve([{ n: 0 }]),
  ]);

  // The shared QA queue only shows files this QA member is allowed to review.
  const pool = toReview.filter((r) => r.reviewer_id === null);
  await acl.loadFileAces(pool.map((r) => r.id));
  const reviewable = toReview.filter((r) => r.reviewer_id !== null || acl.filePerms(u, r).has("review"));

  const withPath = <T extends { folder_id: number }>(rows: T[]) =>
    rows.filter((r) => acl.exists(r.folder_id)).map((r) => ({ ...r, path: acl.pathText(r.folder_id) }));
  return json({
    toReview: withPath(reviewable),
    changesRequested: withPath(changesRequested),
    inReview: withPath(inReview),
    drafts: withPath(drafts),
    myRequests: myRequests.map((r) => ({
      ...r,
      resource_name: r.resource_type === "folder" ? acl.folders.get(r.resource_id as number)?.name ?? "(deleted)" : `File #${r.resource_id}`,
    })),
    pendingAccessRequests: (pendingRequests[0] as { n: number }).n,
  });
});
