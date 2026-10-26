import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { fileAccess } from "@/lib/files";
import { HttpError, intParam, json, route } from "@/lib/http";
import { fileLinkToken, onlyofficeSettings, signForDocs } from "@/lib/onlyoffice";
import { activeSession } from "@/lib/sessions";

type Ctx = { params: Promise<{ id: string }> };

// Signed ONLYOFFICE editor configuration. The mode is decided here, never by the browser:
// "edit" only for the user holding the check-out; everyone else gets a read-only view.
export const GET = route<Ctx>(async (req, { params }) => {
  const s = onlyofficeSettings();
  if (!s) throw new HttpError(501, "The Excel editor (ONLYOFFICE) is not configured on this server.");
  const u = await requireUser();
  const id = intParam((await params).id);
  const { file } = await fileAccess(u, id, "read");
  const vParam = new URL(req.url).searchParams.get("v");
  const versionNo = vParam ? intParam(vParam, "version") : file.current_version;
  const session = versionNo === file.current_version ? await activeSession(id) : null;
  const editing = !!session && session.user_id === u.id;

  const ver = await one<{ sha256: string }>("SELECT sha256 FROM file_versions WHERE file_id = $1 AND version_no = $2", [id, versionNo]);
  if (!ver) throw new HttpError(404, "Version not found.");
  const token = editing ?await fileLinkToken({ fileId: id, session: session!.id }) : await fileLinkToken({ fileId: id, version: versionNo });
  const config = {
    type: "desktop",
    documentType: "cell",
    width: "100%",
    height: "100%",
    document: {
      fileType: "xlsx",
      // A key identifies one exact content to Document Server: per session while editing, per immutable version otherwise.
      key: editing ? session!.doc_key : `sv${id}v${versionNo}-${ver.sha256.slice(0, 16)}`,
      title: file.name,
      url: `${s.appUrl}/api/onlyoffice/file?t=${encodeURIComponent(token)}`,
      permissions: {
        edit: editing,
        comment: false,
        download: false, // downloads go through SheetVault so they are audited
        print: true,
        review: false,
        copy: true,
        protect: false, // users cannot change sheet protection
        chat: false,
      },
    },
    editorConfig: {
      mode: editing ? "edit" : "view",
      lang: "en",
      region: "en-GB",
      ...(editing ? { callbackUrl: `${s.appUrl}/api/onlyoffice/callback?s=${session!.id}` } : {}),
      user: { id: String(u.id), name: `${u.full_name} (${u.employee_id})` },
      coEditing: { mode: "strict", change: false },
      customization: {
        autosave: true,
        forcesave: true,
        comments: false,
        chat: false,
        help: false,
        feedback: false,
        plugins: false,
        compactHeader: true,
        toolbarNoTabs: false,
        hideRightMenu: false,
        uiTheme: "theme-light",
        logo: { visible: false },
      },
    },
  };
  return json({
    documentServerUrl: s.url,
    editing,
    session: session ? { id: session.id, user_name: session.user_name, employee_id: session.employee_id, started_at: session.started_at, working_saved_at: session.working_saved_at, mine: session.user_id === u.id } : null,
    config: { ...config, token: await signForDocs(config, s.secret) },
  });
});
