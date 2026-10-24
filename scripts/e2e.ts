// End-to-end API test. Run against a THROWAWAY database (it writes permanent audit records):
//   BASE=http://localhost:3100 node --import tsx scripts/e2e.ts
import fs from "fs";
import path from "path";

const BASE = process.env.BASE ?? "http://localhost:3100";
const TEMP = "Qbd@1234";
let failures = 0;

function check(cond: unknown, msg: string) {
  if (cond) console.log("  PASS", msg);
  else {
    failures++;
    console.log("  FAIL", msg);
  }
}

class Client {
  cookie = "";
  constructor(public name: string) {}
  async req(method: string, url: string, body?: unknown, form?: FormData) {
    const res = await fetch(BASE + url, {
      method,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      redirect: "manual",
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(";");
      if (kv.startsWith("sv_session=")) this.cookie = kv.endsWith("=") ? "" : kv;
    }
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data: data as any, headers: res.headers };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  patch = (u: string, b: unknown) => this.req("PATCH", u, b);
  put = (u: string, b: unknown) => this.req("PUT", u, b);
  del = (u: string, b?: unknown) => this.req("DELETE", u, b ?? {});
}

async function firstLogin(c: Client, id: string, newPw: string) {
  const r = await c.post("/api/auth/login", { employeeId: id, password: TEMP });
  check(r.status === 200 && r.data.mustChangePassword, `${id}: signs in with temporary password and must change it`);
  const blocked = await c.get("/api/explorer");
  check(blocked.status === 403, `${id}: blocked from the app until the password is changed`);
  const weak = await c.post("/api/auth/change-password", { currentPassword: TEMP, newPassword: "weak" });
  check(weak.status === 400, `${id}: weak password rejected`);
  const ok = await c.post("/api/auth/change-password", { currentPassword: TEMP, newPassword: newPw });
  check(ok.status === 200, `${id}: password changed`);
}

(async () => {
  console.log("1. Admin first sign-in");
  const admin = new Client("admin");
  await firstLogin(admin, "ADMIN", "Root#2026xyz");
  const root = await admin.get("/api/explorer");
  check(root.status === 200 && root.data.folders.length === 4, "admin sees 4 top-level folders");
  const byName = (list: any[], n: string) => list.find((x) => x.name === n);

  console.log("2. Admin creates users");
  const mk = async (employee_id: string, full_name: string, roles: string[], department: string, manager: number | null) => {
    const r = await admin.post("/api/users", {
      employee_id, full_name, email: `${employee_id.toLowerCase()}@qbd.test`, designation: "Executive", joining_date: "2024-04-01",
      roles, department, unit: "Unit 1", section: "Analytical", reporting_manager_id: manager, justification: "E2E test account",
    });
    check(r.status === 201 && r.data.temporaryPassword === TEMP, `created ${employee_id} (${roles.join(",")})`);
    return r.data.id as number;
  };
  const mgrId = await mk("QBD100", "Meera Manager", ["MANAGER"], "Quality Control", null);
  const anaId = await mk("QBD200", "Arjun Analyst", ["ANALYST"], "Quality Control", mgrId);
  await mk("QBD300", "Vikram Viewer", ["VIEWER"], "Production", mgrId);
  await mk("QBD400", "Qamar QA", ["QA"], "Quality Assurance", null);
  const dup = await admin.post("/api/users", { employee_id: "qbd100", full_name: "Dup", email: "x@qbd.test", designation: "x", joining_date: "2024-01-01", roles: ["VIEWER"], department: "x", unit: "x", reporting_manager_id: null, justification: "duplicate test" });
  check(dup.status === 409, "duplicate Employee ID rejected (case-insensitive)");

  const mgr = new Client("mgr"), ana = new Client("ana"), viewer = new Client("viewer"), qa = new Client("qa");
  await firstLogin(mgr, "QBD100", "Manager#2026x");
  await firstLogin(ana, "QBD200", "Analyst#2026x");
  await firstLogin(viewer, "QBD300", "Viewer#2026x");
  await firstLogin(qa, "QBD400", "Qa#2026xx");

  console.log("3. Folder permissions");
  const aroot = await ana.get("/api/explorer");
  const qcF = byName(aroot.data.folders, "Quality Control");
  const qaF = byName(aroot.data.folders, "Quality Assurance");
  const regF = byName(aroot.data.folders, "Regulatory Submissions");
  const tplF = byName(aroot.data.folders, "Validated Templates");
  check(!qcF.locked && !tplF.locked, "analyst can open Quality Control and Validated Templates");
  check(qaF.locked && regF.locked, "analyst sees Quality Assurance and Regulatory as locked");
  const denied = await ana.get(`/api/explorer?folder=${qaF.id}`);
  check(denied.status === 403 && denied.data.denied, "opening a locked folder is denied");
  const vroot = await viewer.get("/api/explorer");
  check(byName(vroot.data.folders, "Quality Control").locked, "viewer (Production) cannot open Quality Control");

  console.log("4. Access request flow");
  const req = await ana.post("/api/access-requests", { resourceType: "folder", resourceId: regF.id, perms: ["read"], justification: "Need to reference submission sheets" });
  check(req.status === 201, "analyst requests access to Regulatory Submissions");
  const pending = await admin.get("/api/access-requests");
  const myReq = pending.data.requests.find((r: any) => r.resource_id === regF.id);
  check(!!myReq, "admin sees the pending request");
  const appr = await admin.patch(`/api/access-requests/${myReq.id}`, { decision: "APPROVED", note: "ok" });
  check(appr.status === 200, "admin approves");
  check((await ana.get(`/api/explorer?folder=${regF.id}`)).status === 200, "analyst can now open Regulatory Submissions");

  console.log("5. New file from template");
  const qc = await ana.get(`/api/explorer?folder=${qcF.id}`);
  const hplc = byName(qc.data.folders, "HPLC");
  const gc = byName(qc.data.folders, "GC");
  const tpls = await ana.get("/api/templates");
  const t011 = tpls.data.templates.find((t: any) => t.name.includes("EXC-011"));
  check(!!t011, "template EXC-011 is offered");
  const copy = await ana.post(`/api/files/${t011.id}/copy`, { folderId: hplc.id, name: "HPLC Assay Batch B-101.xlsx" });
  check(copy.status === 201, "analyst creates a draft from the template in HPLC");
  const fid = copy.data.id;
  const tplEdit = await ana.post(`/api/files/${t011.id}/save`, { baseVersion: 1, reason: "try", edits: [{ sheet: "Conetnt", cell: "B18", value: "1" }] });
  check(tplEdit.status === 403, "analyst cannot edit the approved master template");

  console.log("6. Editing input cells");
  let f = await ana.get(`/api/files/${fid}`);
  check(f.status === 200 && f.data.file.status === "DRAFT" && f.data.versionNo === 1, "file opens as Draft v1");
  const sheet = f.data.model.sheets[0].name;
  check(f.data.model.sheets[0].cells.B18.u === true && f.data.model.sheets[0].cells.F18.f, "B18 is an input cell; F18 is a formula");
  const locked = await ana.post(`/api/files/${fid}/save`, { baseVersion: 1, reason: "test", edits: [{ sheet, cell: "F18", value: "5" }] });
  check(locked.status === 400, "editing a formula/locked cell is rejected");
  const noReason = await ana.post(`/api/files/${fid}/save`, { baseVersion: 1, reason: "", edits: [{ sheet, cell: "B18", value: "25.5" }] });
  check(noReason.status === 400, "save without a reason is rejected");
  const save1 = await ana.post(`/api/files/${fid}/save`, { baseVersion: 1, reason: "Entered standard weight", edits: [{ sheet, cell: "B18", value: "25.5" }, { sheet, cell: "B5", value: "Paracetamol API" }] });
  check(save1.status === 200 && save1.data.version === 2 && save1.data.changes === 2, "save creates v2 with 2 cell changes");
  f = await ana.get(`/api/files/${fid}`);
  const F18 = f.data.model.sheets[0].cells.F18.v;
  check(Math.abs(F18 - 255) < 1e-9, `formula F18 recalculated on the server (=${F18})`);
  const stale = await ana.post(`/api/files/${fid}/save`, { baseVersion: 1, reason: "stale", edits: [{ sheet, cell: "B18", value: "1" }] });
  check(stale.status === 409, "saving from a stale version is rejected");

  console.log("7. Submit for review (e-signature)");
  const revs = await ana.get(`/api/files/${fid}/reviewers`);
  check(revs.data.reviewers.some((r: any) => r.id === mgrId && r.isReportingManager), "manager is an eligible reviewer and flagged as reporting manager");
  check(!revs.data.reviewers.some((r: any) => r.id === anaId), "author is not an eligible reviewer");
  const badSig = await ana.post(`/api/files/${fid}/submit`, { reviewerId: mgrId, comment: "Please review", password: "wrong" });
  check(badSig.status === 403 && /signature/i.test(badSig.data.error), "wrong e-signature password rejected without ending the session");
  check((await ana.get(`/api/files/${fid}`)).status === 200, "session still valid after a failed signature");
  const sub = await ana.post(`/api/files/${fid}/submit`, { reviewerId: mgrId, comment: "Please review", password: "Analyst#2026x" });
  check(sub.status === 200, "submitted for review");
  const lockedSave = await ana.post(`/api/files/${fid}/save`, { baseVersion: 2, reason: "change during review", edits: [{ sheet, cell: "B18", value: "1" }] });
  check(lockedSave.status === 409, "file is locked while in review");

  console.log("8. Reviewer annotates and requests changes");
  const tasks = await mgr.get("/api/tasks");
  check(tasks.data.toReview.some((t: any) => t.id === fid), "file appears in manager's review queue");
  const notAssigned = await qa.post(`/api/files/${fid}/annotations`, { sheet, cell: "B18", comment: "QA note" });
  check(notAssigned.status === 403, "a non-assigned reviewer cannot annotate");
  const ann = await mgr.post(`/api/files/${fid}/annotations`, { sheet, cell: "B18", comment: "Weight does not match the balance printout (25.19 mg)." });
  check(ann.status === 201, "manager adds an annotation on B18");
  const ann2 = await mgr.post(`/api/files/${fid}/annotations`, { comment: "General: attach chromatogram reference." });
  const tmpDel = await mgr.del(`/api/annotations/${ann2.data.id}`);
  check(tmpDel.status === 200, "reviewer can delete their own open annotation in the current review");
  const earlyApprove = await mgr.post(`/api/files/${fid}/decision`, { decision: "APPROVED", password: "Manager#2026x" });
  check(earlyApprove.status === 400, "cannot approve while annotations are open");
  const reject = await mgr.post(`/api/files/${fid}/decision`, { decision: "CHANGES_REQUESTED", comment: "See annotation", password: "Manager#2026x" });
  check(reject.status === 200, "manager requests changes");

  console.log("9. Author corrects, responds and resubmits");
  const anaTasks = await ana.get("/api/tasks");
  check(anaTasks.data.changesRequested.some((t: any) => t.id === fid), "file appears under analyst's 'changes requested'");
  const earlySubmit = await ana.post(`/api/files/${fid}/submit`, { reviewerId: mgrId, password: "Analyst#2026x" });
  check(earlySubmit.status === 409, "cannot resubmit until open annotations are answered");
  const save2 = await ana.post(`/api/files/${fid}/save`, { baseVersion: 2, reason: "Corrected weight per printout", edits: [{ sheet, cell: "B18", value: "25.19" }] });
  check(save2.status === 200 && save2.data.version === 3, "author saves v3");
  const resp = await ana.patch(`/api/annotations/${ann.data.id}`, { action: "respond", text: "Corrected to 25.19 mg as per balance printout." });
  check(resp.status === 200, "author responds to the annotation");
  const resub = await ana.post(`/api/files/${fid}/submit`, { reviewerId: mgrId, comment: "Weight corrected", password: "Analyst#2026x" });
  check(resub.status === 200, "author resubmits (cycle 2)");

  console.log("10. Reviewer verifies and approves");
  const mf = await mgr.get(`/api/files/${fid}`);
  check(mf.data.isReviewer && mf.data.changedSinceReview.some((c: any) => c.cell === "B18" && c.new_value === "25.19"), "reviewer sees B18 highlighted as changed since last review");
  const msgs = await mgr.get(`/api/files/${fid}/annotations`);
  check(msgs.data.messages.filter((m: any) => m.annotation_id === ann.data.id).length === 2, "annotation thread has comment + response");
  const approve = await mgr.post(`/api/files/${fid}/decision`, { decision: "APPROVED", comment: "Verified", password: "Manager#2026x" });
  check(approve.status === 200, "manager approves with e-signature");
  const done = await ana.get(`/api/files/${fid}`);
  check(done.data.file.status === "APPROVED" && done.data.annotations.every((a: any) => a.status === "CLOSED"), "file Approved; annotations closed");
  check((await ana.post(`/api/files/${fid}/save`, { baseVersion: 3, reason: "post-approval edit", edits:[{ sheet, cell: "B18", value: "1" }] })).status === 409, "approved file is read-only");

  console.log("11. Reports, history, download");
  const rep = await mgr.get("/api/reports");
  const row = rep.data.rows.find((r: any) => r.id === fid);
  check(row && row.status === "APPROVED" && row.review_cycle === 2 && row.changes_requested === 1 && row.ann_closed === 1, "review report row is correct");
  const csv = await mgr.get("/api/reports?format=csv");
  check(csv.status === 200 && Buffer.from(csv.data).toString("utf8").includes("HPLC Assay Batch B-101.xlsx"), "CSV export contains the file");
  const hist = await viewer.get(`/api/files/${fid}/history`);
  check(hist.status === 403, "viewer cannot read the file history");
  const h = await ana.get(`/api/files/${fid}/history`);
  check(h.data.versions.length === 3 && h.data.reviews.length === 2 && h.data.changes.length === 3, "history has 3 versions, 2 reviews, 3 cell changes");
  const dl = await ana.get(`/api/files/${fid}/download?annotations=1`);
  check(dl.status === 200 && (dl.headers.get("content-type") ?? "").includes("spreadsheetml") && (dl.data as ArrayBuffer).byteLength > 10000, "annotated workbook downloads");

  console.log("12. Audit trail");
  check((await ana.get("/api/audit")).status === 403, "analyst cannot open the global audit trail");
  const fa = await ana.get(`/api/audit?entityType=file&entityId=${fid}`);
  check(fa.status === 200 && fa.data.rows.some((r: any) => r.action === "FILE_APPROVED"), "analyst can see the trail of their own file");
  const qaAudit = await qa.get("/api/audit?action=FILE_EDITED");
  const edit = qaAudit.data.rows.find((r: any) => r.entity_id === String(fid) && r.details.toVersion === 3);
  check(edit && edit.reason === "Corrected weight per printout" && edit.details.changes[0].old === 25.5 && edit.details.changes[0].new === 25.19, "QA sees who/what/old/new/why for the edit");
  const v = await qa.post("/api/audit/verify");
  check(v.data.ok && v.data.checked > 20,`hash chain verified (${v.data.checked} records)`);

  console.log("13. Upload, security tab, delete/restore");
  const buf = fs.readFileSync(path.join("seed", fs.readdirSync("seed").find((x) => x.includes("155"))!));
  const form = new FormData();
  form.set("folderId", String(gc.id));
  form.set("file", new Blob([buf]), "GC content.xlsx");
  const up = await ana.req("POST", "/api/files/upload", undefined, form);
  check(up.status === 201, "analyst uploads an xlsx into GC");
  const bad = new FormData();
  bad.set("folderId", String(gc.id));
  bad.set("file", new Blob(["hello"]), "notes.txt");
  check((await ana.req("POST", "/api/files/upload", undefined, bad)).status === 400, "non-xlsx upload rejected");
  const vform = new FormData();
  vform.set("folderId", String(gc.id));
  vform.set("file", new Blob([buf]), "x.xlsx");
  check((await viewer.req("POST", "/api/files/upload", undefined, vform)).status === 403, "viewer cannot upload");

  check((await ana.put(`/api/folders/${hplc.id}/security`, { inherit: true, aces: [], reason: "x" })).status === 403, "analyst cannot change permissions");
  const sec = await admin.put(`/api/folders/${hplc.id}/security`, { inherit: true, aces: [{ principal_type: "user", principal_value: String((await admin.get("/api/users")).data.users.find((u: any) => u.employee_id === "QBD300").id), perms: ["read"] }], reason: "Viewer needs to read HPLC sheets" });
  check(sec.status === 200 && sec.data.changed, "admin grants viewer read on HPLC via Security tab");
  check((await viewer.get(`/api/explorer?folder=${hplc.id}`)).status === 200, "viewer can now open HPLC");
  const sdata = await admin.get(`/api/folders/${hplc.id}/security`);
  check(sdata.data.inherited.length >= 3 && sdata.data.explicit.length === 1, "security tab shows explicit + inherited entries");

  check((await ana.del(`/api/files/${fid}`, { reason: "cleanup" })).status === 403, "analyst cannot delete (no Delete right)");
  check((await mgr.del(`/api/files/${fid}`, { reason: "" })).status === 400, "delete requires a reason");
  check((await mgr.del(`/api/files/${fid}`, { reason: "Duplicate record" })).status === 200, "manager moves the file to the Recycle Bin");
  check((await ana.get(`/api/files/${fid}`)).status === 404, "deleted file is no longer accessible");
  const bin = await admin.get("/api/recycle-bin");
  check(bin.data.files.some((x: any) => x.id === fid), "file is in the Recycle Bin");
  check((await admin.post("/api/recycle-bin", { type: "file", id: fid, reason: "Deleted in error" })).status === 200, "admin restores it");
  check((await ana.get(`/api/files/${fid}`)).status === 200, "file is accessible again");

  console.log("14. Account security");
  for (let i = 0; i < 5; i++) await new Client("x").post("/api/auth/login", { employeeId: "QBD300", password: "nope" });
  const lockedLogin = await new Client("x").post("/api/auth/login", { employeeId: "QBD300", password: "Viewer#2026x" });
  check(lockedLogin.status === 401 && /locked/i.test(lockedLogin.data.error), "account locks after 5 failed attempts");
  const vid = (await admin.get("/api/users")).data.users.find((u: any) => u.employee_id === "QBD300").id;
  check((await admin.patch(`/api/users/${vid}`, { action: "unlock", reason: "Verified identity" })).status === 200, "admin unlocks");
  check((await admin.patch(`/api/users/${vid}`, { action: "reset_password", reason: "Forgot password" })).status === 200, "admin resets password");
  check((await viewer.get("/api/explorer")).status === 401, "reset invalidates the user's existing session");
  const relog = await new Client("v2").post("/api/auth/login", { employeeId: "QBD300", password: TEMP });
  check(relog.status === 200 && relog.data.mustChangePassword, "user signs in with Qbd@1234 and must change it");
  const upd = await admin.patch(`/api/users/${vid}`, { action: "update", reason: "Transfer", data: { department: "Quality Control", roles: ["VIEWER", "ANALYST"] } });
  check(upd.status === 200, "admin updates department and roles");

  const v2 = await qa.post("/api/audit/verify");
  check(v2.data.ok, "audit chain still intact at the end");

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})();
