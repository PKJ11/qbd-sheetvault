import { audit } from "@/lib/audit";
import { q } from "@/lib/db";
import { sha256 } from "@/lib/files";
import { intParam } from "@/lib/http";
import { newDocKey, onlyofficeSettings, verifyFromDocs } from "@/lib/onlyoffice";
import { sessionById } from "@/lib/sessions";

interface CallbackBody {
  key: string;
  status: number; // 1 editing, 2 ready to save (closed), 3 save error, 4 closed without changes, 6 force-saved, 7 force-save error
  url?: string;
  users?: string[];
  forcesavetype?: number;
}

const ok = () => Response.json({ error: 0 });

// Document Server reports editing state here and hands over the edited file.
// The file only becomes a working copy of the check-out; a version is created at check-in.
export async function POST(req: Request) {
  const s = onlyofficeSettings();
  if (!s) return Response.json({ error: 1 });
  let body: CallbackBody;
  try {
    const raw = (await req.json()) as CallbackBody & { token?: string };
    const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const token = raw.token ?? header;
    if (!token) throw new Error("missing token");
    body = await verifyFromDocs<CallbackBody>(token, s.secret); // trust only the signed payload
  } catch (e) {
    console.error("ONLYOFFICE callback rejected:", (e as Error).message);
    return Response.json({ error: 1 }, { status: 403 });
  }

  const sessionId = intParam(new URL(req.url).searchParams.get("s"), "session");
  const session = await sessionById(sessionId);
  if (!session || session.status !== "ACTIVE" || session.doc_key !== body.key) return ok(); // stale or discarded session
  const actor = { id: session.user_id, employee_id: session.employee_id ?? null, full_name: session.user_name ?? null, ip: "onlyoffice" };

  if ((body.status === 2 || body.status === 6) && body.url) {
    if (body.users?.some((x) => x !== String(session.user_id))) {
      await audit(actor, { action: "EDITOR_UNEXPECTED_USER", entityType: "file", entityId: session.file_id, details: { editSession: session.id, users: body.users } });
      return Response.json({ error: 1 });
    }
    const res = await fetch(body.url);
    if (!res.ok) {
      console.error("ONLYOFFICE callback: download failed", res.status);
      return Response.json({ error: 1 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = sha256(buf);
    // Status 2 means the editor closed: rotate the key so the next opening loads this working copy.
    await q(
      `UPDATE edit_sessions SET working_content = $2, working_sha256 = $3, working_saved_at = now()${body.status === 2 ? ", doc_key = $4" : ""}
       WHERE id = $1 AND status = 'ACTIVE'`,
      body.status === 2 ? [session.id, buf, hash, newDocKey(`sv${session.file_id}s${session.id}`)] : [session.id, buf, hash],
    );
    await audit(actor, {
      action: "EDITOR_WORKING_COPY_SAVED",
      entityType: "file",
      entityId: session.file_id,
      details: { editSession: session.id, sha256: hash, size: buf.length, trigger: body.status === 2 ? "editor closed" : "save requested" },
    });
  } else if (body.status === 3 || body.status === 7) {
    await audit(actor, { action: "EDITOR_SAVE_ERROR", entityType: "file", entityId: session.file_id, details: { editSession: session.id, status: body.status } });
  }
  return ok();
}
