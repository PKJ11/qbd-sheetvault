// Prints a file's version, check-out and recent audit entries. Usage: npm run file:status -- <fileId>
import { pool, q } from "../lib/db";

(async () => {
  const id = Number(process.argv[2]);
  const [f] = await q("SELECT id, name, status, current_version FROM files WHERE id = $1", [id]);
  const sessions = await q(
    `SELECT id, status, base_version, working_sha256 IS NOT NULL AS has_working_copy, working_saved_at, started_at, ended_at
     FROM edit_sessions WHERE file_id = $1 ORDER BY id`,
    [id],
  );
  const audit = await q(
    "SELECT ts, employee_id, action, reason, details FROM audit_log WHERE entity_type = 'file' AND entity_id = $1 ORDER BY id DESC LIMIT 12",
    [String(id)],
  );
  console.log("file:", f);
  console.log("edit sessions:", sessions);
  for (const a of audit.reverse())
    console.log(`${new Date(a.ts).toLocaleTimeString("en-GB")} ${a.employee_id} ${a.action}${a.reason ? ` [${a.reason}]` : ""} ${a.details ? JSON.stringify(a.details).slice(0, 300) : ""}`);
  await pool().end();
})();
