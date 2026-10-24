import { requireUser } from "@/lib/auth";
import { body, intParam, json, route } from "@/lib/http";
import { AcesInput, getSecurity, putSecurity } from "@/lib/security";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return json(await getSecurity(u, "file", intParam((await params).id)));
});

export const PUT = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  return json(await putSecurity(u, "file", intParam((await params).id), AcesInput.parse(await body(req))));
});
