import { canSeeAllReports, canSeeAuditTrail, isAdmin, requireUser } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const u = await requireUser({ allowPasswordChange: true });
  return json({
    user: u,
    capabilities: { admin: isAdmin(u), reports: canSeeAllReports(u), audit: canSeeAuditTrail(u) },
  });
});
