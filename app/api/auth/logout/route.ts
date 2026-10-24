import { audit } from "@/lib/audit";
import { actorOf, clearSessionCookie, currentUser } from "@/lib/auth";
import { json, route } from "@/lib/http";

export const POST = route(async (req) => {
  const u = await currentUser();
  const reason = new URL(req.url).searchParams.get("reason");
  if (u) {
    await audit(await actorOf(u), {
      action: reason === "idle" ? "LOGOUT_IDLE_TIMEOUT" : "LOGOUT",
      entityType: "auth",
      entityName: u.employee_id,
    });
  }
  await clearSessionCookie();
  return json({ ok: true });
});
