import { isAdmin, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { json, route } from "@/lib/http";
import { Acl } from "@/lib/permissions";

const FILE_COLS = `f.id, f.name, f.status, f.current_version, f.review_cycle, f.updated_at, f.folder_id,
  (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'OPEN') AS open_annotations,
  (SELECT count(*)::int FROM annotations a WHERE a.file_id = f.id AND a.status = 'ADDRESSED') AS addressed_annotations`;

export const GET = route(async () => {
  const u = await requireUser();
  const acl = await Acl.load();
  const pathOf = (folderId: number) => acl.path(folderId).map((f) => f.name).join(" \\ ");

  const [toReview, changesRequested, inReview, drafts, myRequests, pendingRequests] = await Promise.all([
    q<{ folder_id: number }>(
      `SELECT ${FILE_COLS}, r.submitted_at, r.submit_comment, r.cycle_no, su.full_name AS submitted_by_name
       FROM reviews r JOIN files f ON f.id = r.file_id JOIN users su ON su.id = r.submitted_by
       WHERE r.reviewer_id = $1 AND r.decision IS NULL AND f.deleted_at IS NULL ORDER BY r.submitted_at`,
      [u.id],
    ),
    q<{ folder_id: number }>(
      `SELECT ${FILE_COLS}, r.decided_at, r.decision_comment, ru.full_name AS reviewer_name
       FROM files f
       LEFT JOIN LATERAL (SELECT * FROM reviews r WHERE r.file_id = f.id AND r.decision = 'CHANGES_REQUESTED' ORDER BY r.id DESC LIMIT 1) r ON TRUE
       LEFT JOIN users ru ON ru.id = r.reviewer_id
       WHERE f.owner_id = $1 AND f.status = 'CHANGES_REQUESTED' AND f.deleted_at IS NULL ORDER BY f.updated_at DESC`,
      [u.id],
    ),
    q<{ folder_id: number }>(
      `SELECT ${FILE_COLS}, r.submitted_at, ru.full_name AS reviewer_name
       FROM files f JOIN reviews r ON r.file_id = f.id AND r.decision IS NULL JOIN users ru ON ru.id = r.reviewer_id
       WHERE f.owner_id = $1 AND f.status = 'IN_REVIEW' AND f.deleted_at IS NULL ORDER BY r.submitted_at DESC`,
      [u.id],
    ),
    q<{ folder_id: number }>(
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
  const withPath = <T extends { folder_id: number }>(rows: T[]) =>
    rows.filter((r) => acl.exists(r.folder_id)).map((r) => ({ ...r, path: pathOf(r.folder_id) }));
  return json({
    toReview: withPath(toReview),
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
