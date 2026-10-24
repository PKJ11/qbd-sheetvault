// Re-computes the audit trail hash chain. Usage: npm run audit:verify
import { verifyChain } from "../lib/audit";
import { pool } from "../lib/db";

verifyChain()
  .then((r) => {
    console.log(r.ok ? `Audit trail intact: ${r.checked} records verified.` : `Audit trail BROKEN at record ${r.brokenAt} (${r.checked} valid before it).`);
    if (!r.ok) process.exitCode = 1;
  })
  .finally(() => pool().end());
