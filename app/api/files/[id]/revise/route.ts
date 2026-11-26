import { requireUser } from "@/lib/auth";
import { fileAccess } from "@/lib/files";
import { HttpError, intParam, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// QA-approved workbooks are final: nobody can reopen them. Start a new workbook from a validated template instead.
// Kept so old clients get a clear answer instead of a 404.
export const POST = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  await fileAccess(u, intParam((await params).id), "read");
  throw new HttpError(409, "QA-approved workbooks are locked permanently and can't be reopened. Create a new workbook from a validated template instead.");
});
