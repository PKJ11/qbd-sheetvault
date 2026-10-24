// DEVELOPMENT ONLY: drops every SheetVault table (including the audit trail) so `db:migrate` starts fresh.
// Usage: npm run db:reset -- --yes
import { pool } from "../lib/db";

if (!process.argv.includes("--yes")) {
  console.error("Refusing to run without --yes. This permanently deletes all SheetVault data.");
  process.exit(1);
}

pool()
  .query(
    `DROP TABLE IF EXISTS audit_log, access_requests, annotation_messages, annotations, reviews, permissions,
       cell_changes, file_versions, files, folders, users CASCADE;
     DROP FUNCTION IF EXISTS audit_log_immutable();`,
  )
  .then(() => console.log("All SheetVault tables dropped."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
