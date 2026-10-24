import { audit } from "@/lib/audit";
import { actorOf, requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { withNotes } from "@/lib/excel/write";
import { fileAccess, versionContent } from "@/lib/files";
import { intParam, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = intParam((await params).id);
  const { file } = await fileAccess(u, id, "read");
  const sp = new URL(req.url).searchParams;
  const versionNo = sp.get("v") ? intParam(sp.get("v"), "version") : file.current_version;
  const withAnnotations = sp.get("annotations") === "1";

  let buf: Buffer = await versionContent(id, versionNo);
  if (withAnnotations) {
    const anns = await q<{ sheet: string; cell: string; comment: string; status: string; by: string; response: string | null }>(
      `SELECT a.sheet, a.cell, a.comment, a.status, u.full_name AS by, a.response
       FROM annotations a JOIN users u ON u.id = a.created_by
       WHERE a.file_id = $1 AND a.cell IS NOT NULL ORDER BY a.id`,
      [id],
    );
    buf = await withNotes(
      buf,
      anns.map((a) => ({
        sheet: a.sheet,
        cell: a.cell,
        text: `[${a.status}] ${a.by}: ${a.comment}${a.response ? `\nResponse: ${a.response}` : ""}`,
      })),
    );
  }

  await audit(await actorOf(u), {
    action: "FILE_DOWNLOADED",
    entityType: "file",
    entityId: id,
    entityName: file.name,
    details: { version: versionNo, withAnnotations },
  });

  const base = file.name.replace(/\.xlsx$/i, "");
  const name = `${base}_v${versionNo}${withAnnotations ? "_annotated" : ""}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.()\- ]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
});
