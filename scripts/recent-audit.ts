// Prints the most recent audit records. Usage: npm run audit:recent [-- 30]
import { pool, q } from "../lib/db";

const n = Number(process.argv[2] ?? 25);
q(`SELECT id, ts, employee_id, action, entity_type, entity_id, entity_name, reason, details FROM audit_log ORDER BY id DESC LIMIT $1`, [n])
  .then((rows) => {
    for (const r of rows.reverse())
      console.log(
        `#${r.id} ${new Date(r.ts).toLocaleString("en-GB")} ${r.employee_id ?? "-"} ${r.action} ${r.entity_type}:${r.entity_id ?? ""} ${r.entity_name ?? ""}` +
          `${r.reason ? ` reason="${r.reason}"` : ""} ${r.details ? JSON.stringify(r.details).slice(0, 220) : ""}`,
      );
  })
  .finally(() => pool().end());
