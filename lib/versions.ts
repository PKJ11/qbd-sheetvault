import "server-only";
import type { Actor } from "./audit";
import { writeAudit } from "./audit";
import type { Db } from "./db";
import type { WorkbookModel } from "./excel/model";
import type { CellChange } from "./excel/write";
import { cellText, storeVersion, type FileRow } from "./files";

/** Store a new version, its cell-level change log, bump the file, and audit — inside the caller's transaction. */
export async function commitVersion(
  db: Db,
  actor: Actor,
  file: FileRow,
  opts: { buffer: Buffer; model: WorkbookModel; changes: CellChange[]; reason: string; source: "grid" | "editor"; sessionId?: number },
): Promise<number> {
  const next = file.current_version + 1;
  await storeVersion(db, file.id, next, opts.buffer, opts.model, actor.id!, opts.reason);
  if (opts.changes.length) {
    await db.query(
      `INSERT INTO cell_changes (file_id, version_no, sheet, cell, old_value, new_value, reason, changed_by)
       SELECT $1, $2, s, c, o, n, $7, $8 FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS t(s, c, o, n)`,
      [
        file.id,
        next,
        opts.changes.map((c) => c.sheet),
        opts.changes.map((c) => c.cell),
        opts.changes.map((c) => cellText(c.old)),
        opts.changes.map((c) => cellText(c.new)),
        opts.reason,
        actor.id,
      ],
    );
  }
  await db.query("UPDATE files SET current_version = $2, size_bytes = $3, updated_at = now(), updated_by = $4 WHERE id = $1", [
    file.id,
    next,
    opts.buffer.length,
    actor.id,
  ]);
  await writeAudit(db, actor, {
    action: "FILE_EDITED",
    entityType: "file",
    entityId: file.id,
    entityName: file.name,
    reason: opts.reason,
    details: {
      fromVersion: file.current_version,
      toVersion: next,
      source: opts.source === "editor" ? "ONLYOFFICE editor (check-in)" : "SheetVault grid",
      ...(opts.sessionId ? { editSession: opts.sessionId } : {}),
      changes: opts.changes.map((c) => ({ cell: `${c.sheet}!${c.cell}`, old: c.old, new: c.new })),
    },
  });
  return next;
}
