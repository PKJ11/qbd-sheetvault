import { one } from "@/lib/db";
import { getFile, sha256, versionContent } from "@/lib/files";
import { HttpError, route } from "@/lib/http";
import { readFileLinkToken } from "@/lib/onlyoffice";

// Called by Document Server (not the browser) to fetch the workbook. Authorised by a short-lived signed link.
export const GET = route(async (req) => {
  const t = new URL(req.url).searchParams.get("t");
  let claims;
  try {
    claims = await readFileLinkToken(t ?? "");
  } catch {
    throw new HttpError(403, "Invalid or expired file link.");
  }
  const file = await getFile(claims.fileId);
  let content: Buffer;
  if (claims.session) {
    const s = await one<{ base_version: number; working_content: Buffer | null; working_sha256: string | null; status: string }>(
      "SELECT base_version, working_content, working_sha256, status FROM edit_sessions WHERE id = $1 AND file_id = $2",
      [claims.session, file.id],
    );
    if (!s || s.status !== "ACTIVE") throw new HttpError(410, "This editing session has ended.");
    if (s.working_content) {
      if (sha256(s.working_content) !== s.working_sha256) throw new HttpError(500, "Working copy integrity check failed.");
      content = s.working_content;
    } else content = await versionContent(file.id, s.base_version);
  } else {
    content = await versionContent(file.id, claims.version ?? file.current_version);
  }
  return new Response(new Uint8Array(content), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" },
  });
});
