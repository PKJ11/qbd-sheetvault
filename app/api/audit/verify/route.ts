import { audit, verifyChain } from "@/lib/audit";
import { actorOf, canSeeAuditTrail, requireUser } from "@/lib/auth";
import { HttpError, json, route } from "@/lib/http";

export const POST = route(async () => {
  const u = await requireUser();
  if (!canSeeAuditTrail(u)) throw new HttpError(403, "Audit trail access requires the Admin or QA role.");
  const result = await verifyChain();
  await audit(await actorOf(u), { action: "AUDIT_TRAIL_VERIFIED", entityType: "report", entityName: "Audit trail", details: result });
  return json(result);
});
