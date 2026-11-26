// SAMPLE DATA: a realistic Quality Control folder tree (AR numbers by category) and workbooks at every workflow stage,
// created through the same workflow code the app uses (versions, cell-change log, reviews, e-signature audit records,
// QA copies). Three workbooks are taken all the way to QA approval, so they also appear under Quality Assurance.
//
// Usage: npm run db:seed-sample        (run npm run db:migrate and npm run db:seed-demo first; runs only once)
import type { PoolClient } from "pg";
import { writeAudit, type Actor } from "../lib/audit";
import { USER_COLUMNS, type User } from "../lib/auth";
import { one, pool, q, tx } from "../lib/db";
import { applyEdits } from "../lib/excel/write";
import { getFile, storeVersion, uniqueFileName, versionContent, type FileRow } from "../lib/files";
import { Acl } from "../lib/permissions";
import { commitVersion } from "../lib/versions";
import { activeReview, recordDecision } from "../lib/workflow";

type Edit = { sheet: string; cell: string; value: string | number | null };

const actorOf = (u: User): Actor => ({ id: u.id, employee_id: u.employee_id, full_name: u.full_name, ip: "sample-data" });

async function user(employeeId: string): Promise<User> {
  const u = await one<User>(`SELECT ${USER_COLUMNS} FROM users WHERE upper(employee_id) = upper($1)`, [employeeId]);
  if (!u) throw new Error(`User ${employeeId} not found. Run npm run db:seed-demo first.`);
  return u;
}

// ---------- folders ----------

async function folder(db: PoolClient, by: User, parent: { id: number; path: string }, name: string) {
  const found = await one<{ id: number }>(
    "SELECT id FROM folders WHERE parent_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL",
    [parent.id, name],
    db,
  );
  const path = `${parent.path} \\ ${name}`;
  if (found) return { id: found.id, path };
  const r = await db.query<{ id: number }>("INSERT INTO folders (parent_id, name, created_by) VALUES ($1,$2,$3) RETURNING id", [parent.id, name, by.id]);
  await writeAudit(db, actorOf(by), { action: "FOLDER_CREATED", entityType: "folder", entityId: r.rows[0].id, entityName: name, details: { parent: parent.path } });
  return { id: r.rows[0].id, path };
}

// ---------- workflow steps (mirror the API routes) ----------

interface Template { id: number; name: string; current_version: number }

async function newFromTemplate(owner: User, tpl: Template, dest: { id: number; path: string }, name: string): Promise<number> {
  return tx(async (db) => {
    const buf = await versionContent(tpl.id, tpl.current_version, db);
    const v = await one<{ model: unknown }>("SELECT model FROM file_versions WHERE file_id = $1 AND version_no = $2", [tpl.id, tpl.current_version], db);
    const finalName = await uniqueFileName(db, dest.id, name);
    const r = await db.query<{ id: number }>(
      "INSERT INTO files (folder_id, name, owner_id, size_bytes, updated_by) VALUES ($1,$2,$3,$4,$3) RETURNING id",
      [dest.id, finalName, owner.id, buf.length],
    );
    const id = r.rows[0].id;
    await storeVersion(db, id, 1, buf, v!.model as never, owner.id, `Created from template "${tpl.name}" v${tpl.current_version}`);
    await db.query("UPDATE folders SET updated_at = now() WHERE id = $1", [dest.id]);
    await writeAudit(db, actorOf(owner), {
      action: "FILE_CREATED_FROM_TEMPLATE",
      entityType: "file",
      entityId: id,
      entityName: finalName,
      details: { template: tpl.name, templateId: tpl.id, templateVersion: tpl.current_version, folder: dest.path },
    });
    return id;
  });
}

async function save(fileId: number, by: User, edits: Edit[], reason: string) {
  await tx(async (db) => {
    const file = await getFile(fileId, db, true);
    const out = await applyEdits(await versionContent(fileId, file.current_version, db), edits);
    if (out.changes.length) await commitVersion(db, actorOf(by), file, { buffer: out.buffer, model: out.model, changes: out.changes, reason, source: "grid" });
  });
}

async function submit(fileId: number, author: User, manager: User, comment: string) {
  await tx(async (db) => {
    const file = await getFile(fileId, db, true);
    const cycle = file.review_cycle + 1;
    await db.query(
      `INSERT INTO reviews (file_id, cycle_no, version_no, submitted_by, submit_comment, reviewer_id, stage) VALUES ($1,$2,$3,$4,$5,$6,'MANAGER')`,
      [fileId, cycle, file.current_version, author.id, comment, manager.id],
    );
    await db.query("UPDATE files SET status = 'IN_REVIEW', review_cycle = $2, updated_at = now(), updated_by = $3 WHERE id = $1", [fileId, cycle, author.id]);
    await writeAudit(db, actorOf(author), {
      action: file.status === "CHANGES_REQUESTED" ? "FILE_RESUBMITTED" : "FILE_SUBMITTED_FOR_REVIEW",
      entityType: "file",
      entityId: fileId,
      entityName: file.name,
      reason: comment,
      details: {
        stage: "Department manager",
        reviewer: `${manager.full_name} (${manager.employee_id})`,
        department: author.department,
        version: file.current_version,
        cycle,
        statusFrom: file.status,
        statusTo: "IN_REVIEW",
        eSignature: `${author.full_name} (${author.employee_id}) - meaning: submitted for review`,
      },
    });
  });
}

async function annotate(fileId: number, reviewer: User, sheet: string, cell: string, comment: string): Promise<number> {
  return tx(async (db) => {
    const file = await getFile(fileId, db, true);
    const review = (await activeReview(fileId, db))!;
    const r = await db.query<{ id: number }>(
      "INSERT INTO annotations (file_id, review_id, version_no, sheet, cell, comment, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [fileId, review.id, file.current_version, sheet, cell, comment, reviewer.id],
    );
    await db.query("INSERT INTO annotation_messages (annotation_id, kind, text, version_no, created_by) VALUES ($1,'COMMENT',$2,$3,$4)", [r.rows[0].id, comment, file.current_version, reviewer.id]);
    await writeAudit(db, actorOf(reviewer), {
      action: "ANNOTATION_ADDED",
      entityType: "file",
      entityId: fileId,
      entityName: file.name,
      details: { annotationId: r.rows[0].id, stage: review.stage === "QA" ? "QA department" : "Department manager", cell: `${sheet}!${cell}`, comment, version: file.current_version },
    });
    return r.rows[0].id;
  });
}

async function respond(fileId: number, annId: number, author: User, text: string) {
  await tx(async (db) => {
    const file = await getFile(fileId, db);
    const a = await one<{ sheet: string; cell: string; status: string }>("SELECT sheet, cell, status FROM annotations WHERE id = $1", [annId], db);
    await db.query("UPDATE annotations SET status = 'ADDRESSED', response = $2, responded_by = $3, responded_at = now() WHERE id = $1", [annId, text, author.id]);
    await db.query("INSERT INTO annotation_messages (annotation_id, kind, text, version_no, created_by) VALUES ($1,'RESPONSE',$2,$3,$4)", [annId, text, file.current_version, author.id]);
    await writeAudit(db, actorOf(author), {
      action: "ANNOTATION_RESPONDED",
      entityType: "file",
      entityId: fileId,
      entityName: file.name,
      details: { annotationId: annId, cell: `${a!.sheet}!${a!.cell}`, statusFrom: a!.status, statusTo: "ADDRESSED", text, version: file.current_version },
    });
  });
}

async function decide(fileId: number, reviewer: User, decision: "APPROVED" | "CHANGES_REQUESTED", comment: string) {
  return tx(async (db) => {
    const acl = await Acl.load(db, [fileId]);
    const file: FileRow = await getFile(fileId, db, true);
    const review = await activeReview(fileId, db, true);
    if (!review) throw new Error(`No active review on file ${fileId}`);
    return recordDecision(db, actorOf(reviewer), reviewer, acl, file, review, decision, comment);
  });
}

// ---------- realistic sheet contents ----------

const HPLC = "Conetnt";

/** Inputs for QbD-EXC-011 (assay by HPLC). The sample areas are worked out so the assay comes out at `assay` %. */
function hplcInputs(p: {
  product: string; ar: string; batch: string; by: string; date: string; instrument: string;
  standard: string; stdBatch: string; potency: number; stdWt: number; stdAreas: number[]; rt: number;
  sampleWts: [number, number]; assay: [number, number];
}): Edit[] {
  const mean = p.stdAreas.reduce((a, b) => a + b, 0) / p.stdAreas.length;
  // I37 = H37 / mean * (stdWt/10) * (1/10) * (10/sampleWt) * (10/1) * potency/100 * 100
  const area = (wt: number, target: number) => Math.round((target * mean) / ((p.stdWt / 10) * (1 / 10) * (10 / wt) * 10 * (p.potency / 100) * 100));
  const e: Edit[] = [
    { sheet: HPLC, cell: "B5", value: p.product },
    { sheet: HPLC, cell: "B6", value: p.ar },
    { sheet: HPLC, cell: "B7", value: p.batch },
    { sheet: HPLC, cell: "B8", value: p.by },
    { sheet: HPLC, cell: "B9", value: p.date },
    { sheet: HPLC, cell: "B10", value: p.instrument },
    { sheet: HPLC, cell: "B13", value: p.standard },
    { sheet: HPLC, cell: "B14", value: p.stdBatch },
    { sheet: HPLC, cell: "B15", value: p.potency },
    { sheet: HPLC, cell: "B18", value: p.stdWt },
    { sheet: HPLC, cell: "D37", value: p.sampleWts[0] },
    { sheet: HPLC, cell: "H37", value: area(p.sampleWts[0], p.assay[0]) },
    { sheet: HPLC, cell: "D38", value: p.sampleWts[1] },
    { sheet: HPLC, cell: "H38", value: area(p.sampleWts[1], p.assay[1]) },
  ];
  p.stdAreas.forEach((a, i) => {
    e.push({ sheet: HPLC, cell: `B${25 + i}`, value: +(p.rt + (i % 3) * 0.001 - 0.001).toFixed(3) });
    e.push({ sheet: HPLC, cell: `C${25 + i}`, value: a });
  });
  return e;
}

/** Inputs for QbD-EXC-155 (ethylene / diethylene glycol by GC): product, standard batch and the sample row on each sheet. */
function gcInputs(p: { product: string; ar: string; batch: string; instrument: string; notebook: string; page: string; samples: { sheet: string; wt: number; area: number; is: number; result: string }[] }): Edit[] {
  const e: Edit[] = [];
  for (const s of p.samples) {
    e.push(
      { sheet: s.sheet, cell: "C7", value: p.product },
      { sheet: s.sheet, cell: "C9", value: p.instrument },
      { sheet: s.sheet, cell: "N9", value: p.notebook },
      { sheet: s.sheet, cell: "N10", value: p.page },
      { sheet: s.sheet, cell: "C35", value: p.ar },
      { sheet: s.sheet, cell: "D35", value: p.batch },
      { sheet: s.sheet, cell: "E35", value: s.wt },
      { sheet: s.sheet, cell: "G35", value: s.area },
      { sheet: s.sheet, cell: "H35", value: s.is },
      { sheet: s.sheet, cell: "M35", value: s.result },
    );
  }
  return e;
}

// ---------- main ----------

async function main() {
  const qcRoot = await one<{ id: number; name: string }>("SELECT id, name FROM folders WHERE system_key = 'QC' AND deleted_at IS NULL");
  const tplRoot = await one<{ id: number }>("SELECT id FROM folders WHERE system_key = 'TEMPLATES' AND deleted_at IS NULL");
  if (!qcRoot || !tplRoot) throw new Error("System folders missing. Run npm run db:migrate first.");
  const already = await one(
    `SELECT 1 FROM folders f JOIN folders p ON p.id = f.parent_id
     WHERE p.parent_id = $1 AND lower(p.name) = 'ar number' AND f.name = 'Finished Product Analysis' AND f.deleted_at IS NULL`,
    [qcRoot.id],
  );
  if (already) {
    console.log("Sample data already present (Quality Control \\ AR Number \\ Finished Product Analysis exists) - nothing to do.");
    return;
  }

  const [meera, arjun, priya, qamar] = await Promise.all(["QBD100", "QBD200", "QBD201", "QBD400"].map(user));
  const tpl = async (like: string) => {
    const t = await one<Template>(
      "SELECT id, name, current_version FROM files WHERE folder_id = $1 AND name ILIKE $2 AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id LIMIT 1",
      [tplRoot.id, like],
    );
    if (!t) throw new Error(`Template ${like} not found in Validated Templates`);
    return t;
  };
  const tHplc = await tpl("QbD-EXC-011%");
  const tGc = await tpl("QbD-EXC-155%");

  // ----- folder tree -----
  console.log("Creating folders…");
  const F = await tx(async (db) => {
    const qc = { id: qcRoot.id, path: qcRoot.name };
    const ar = await folder(db, meera, qc, "AR Number");
    const cat = {
      rm: await folder(db, meera, ar, "Raw Material Analysis"),
      fp: await folder(db, meera, ar, "Finished Product Analysis"),
      ip: await folder(db, meera, ar, "In-Process Analysis"),
      st: await folder(db, meera, ar, "Stability Studies"),
      dev: await folder(db, meera, ar, "Development Analysis"),
      mv: await folder(db, meera, ar, "Method Validation"),
    };
    const f = {
      r1862: await folder(db, meera, cat.rm, "R20260001862 - Polysorbate 20 (RMB0118084)"),
      r2104: await folder(db, meera, cat.rm, "R20260002104 - Polysorbate 80 (RMB0118219)"),
      r2131: await folder(db, meera, cat.rm, "R20260002131 - Polyethylene Glycol 400 (RMB0118246)"),
      f0871: await folder(db, meera, cat.fp, "F20260000871 - Paracetamol Tablets IP 500 mg (PT26118)"),
      f0879: await folder(db, meera, cat.fp, "F20260000879 - Ibuprofen Tablets IP 400 mg (IB26092)"),
      f0884: await folder(db, meera, cat.fp, "F20260000884 - Amlodipine Besylate Tablets 5 mg (AM26047)"),
      i0455: await folder(db, meera, cat.ip, "I20260000455 - Paracetamol Blend (PT26118)"),
      s0145: await folder(db, meera, cat.st, "S20260000145 - Paracetamol Tablets 500 mg - 6M 40C-75RH"),
      s0152: await folder(db, meera, cat.st, "S20260000152 - Metformin HCl ER Tablets 1000 mg - 3M 25C-60RH"),
      d0312: await folder(db, meera, cat.dev, "D20260000312 - Metformin HCl ER Tablets 1000 mg (Trial T-07)"),
      d0327: await folder(db, meera, cat.dev, "D20260000327 - Atorvastatin Calcium Tablets 20 mg (Trial T-03)"),
      v0021: await folder(db, meera, cat.mv, "V20260000021 - Assay of Atorvastatin Calcium by HPLC"),
    };
    // Supporting QC areas (kept empty, as in a real department share).
    const cal = await folder(db, meera, qc, "Instrument Calibration");
    await folder(db, meera, cal, "HPLC - QbD-INST-HPLC-07");
    await folder(db, meera, cal, "GC - QbD-INST-GCALS-40");
    await folder(db, meera, cal, "Analytical Balance - QbD-INST-BAL-12");
    const rs = await folder(db, meera, qc, "Reference Standards");
    await folder(db, meera, rs, "Working Standards");
    await folder(db, meera, rs, "Primary Standards (USP-IP)");
    const oos = await folder(db, meera, qc, "OOS & Deviations");
    await folder(db, meera, oos, "OOS-2026-014");
    return f;
  });

  // ----- workbooks -----
  const std = { standard: "Paracetamol WS", stdBatch: "WS/PCM/26/004", potency: 99.6, rt: 4.512 };
  const log = (msg: string) => console.log(`  ${msg}`);

  // 1. APPROVED (cycle 1 sent back by the manager, cycle 2 manager -> QA approved): Paracetamol tablets assay
  console.log("Workbooks…");
  {
    const id = await newFromTemplate(arjun, tHplc, F.f0871, "Assay by HPLC - Paracetamol Tablets 500 mg - PT26118.xlsx");
    await save(id, arjun, hplcInputs({ ...std, by: "Arjun Analyst", product: "Paracetamol Tablets IP 500 mg", ar: "F20260000871", batch: "PT26118", date: "11-Nov-2026", instrument: "QbD-INST-HPLC-07", stdWt: 25.12, stdAreas: [19914, 19925, 20014, 20052, 20039], sampleWts: [51.04, 51.02], assay: [99.42, 99.71] }), "Assay data entered from HPLC run PT26118-AS-01");
    await submit(id, arjun, meera, "Assay of PT26118 for release");
    const a = await annotate(id, meera, HPLC, "B18", "Standard weight on the balance printout is 25.21 mg, not 25.12 mg. Please correct.");
    await decide(id, meera, "CHANGES_REQUESTED", "Standard weight transcription error");
    await save(id, arjun, [{ sheet: HPLC, cell: "B18", value: 25.21 }], "Corrected standard weight as per balance printout (BAL-12, 11-Nov-2026)");
    await respond(id, a, arjun, "Corrected to 25.21 mg as per balance printout.");
    await submit(id, arjun, meera, "Standard weight corrected");
    await decide(id, meera, "APPROVED", "Checked against raw data and chromatograms");
    const r = await decide(id, qamar, "APPROVED", "Released - complies with specification (95.0-105.0%)");
    log(`Approved: Paracetamol assay → QA copy at ${r.qaCopy?.path}`);
  }

  // 2. APPROVED straight through: Ibuprofen tablets assay
  {
    const id = await newFromTemplate(priya, tHplc, F.f0879, "Assay by HPLC - Ibuprofen Tablets 400 mg - IB26092.xlsx");
    await save(id, priya, hplcInputs({ ...std, by: "Priya Analyst", standard: "Ibuprofen WS", stdBatch: "WS/IBU/26/002", potency: 99.8, rt: 6.874, product: "Ibuprofen Tablets IP 400 mg", ar: "F20260000879", batch: "IB26092", date: "12-Nov-2026", instrument: "QbD-INST-HPLC-07", stdWt: 25.34, stdAreas: [21452, 21503, 21478, 21466, 21511], sampleWts: [50.88, 50.93], assay: [100.36, 100.12] }), "Assay data entered from HPLC run IB26092-AS-01");
    await submit(id, priya, meera, "Assay of IB26092 for release");
    await decide(id, meera, "APPROVED", "Verified");
    const r = await decide(id, qamar, "APPROVED", "Released - complies (95.0-105.0%)");
    log(`Approved: Ibuprofen assay → QA copy at ${r.qaCopy?.path}`);
  }

  // 3. APPROVED (QA sent it back once): Polysorbate 20 glycols by GC
  {
    const id = await newFromTemplate(priya, tGc, F.r1862, "EG-DEG-TEG by GC - Polysorbate 20 - RMB0118084.xlsx");
    await save(id, priya, gcInputs({ product: "Polysorbate 20", ar: "R20260001862", batch: "RMB0118084", instrument: "QbD-INST-GCALS-40", notebook: "QbD-LNB-G-I-100", page: "061", samples: [
      { sheet: "EG", wt: 4019.1, area: 0, is: 128.56, result: "Not Detected" },
      { sheet: "DEG", wt: 4019.1, area: 0, is: 128.56, result: "Not Detected" },
    ] }), "GC data entered from sequence RMB0118084-GC-01");
    await submit(id, priya, meera, "Glycol impurities for raw material release");
    await decide(id, meera, "APPROVED", "OK");
    const a = await annotate(id, qamar, "DEG", "N10", "Notebook page should be 062 (page 061 is the EG preparation).");
    await decide(id, qamar, "CHANGES_REQUESTED", "Notebook reference for DEG");
    await save(id, priya, [{ sheet: "DEG", cell: "N10", value: "062" }], "Notebook page corrected for DEG preparation");
    await respond(id, a, priya, "Updated to page 062.");
    await submit(id, priya, meera, "QA comment addressed");
    await decide(id, meera, "APPROVED", "Verified the QA correction");
    const r = await decide(id, qamar, "APPROVED", "Released - EG/DEG not detected");
    log(`Approved: Polysorbate 20 GC → QA copy at ${r.qaCopy?.path}`);
  }

  // 4. QA REVIEW (manager approved, waiting for QA): Amlodipine tablets assay
  {
    const id = await newFromTemplate(arjun, tHplc, F.f0884, "Assay by HPLC - Amlodipine Besylate Tablets 5 mg - AM26047.xlsx");
    await save(id, arjun, hplcInputs({ ...std, by: "Arjun Analyst", standard: "Amlodipine Besylate WS", stdBatch: "WS/AML/26/001", potency: 99.4, rt: 8.215, product: "Amlodipine Besylate Tablets 5 mg", ar: "F20260000884", batch: "AM26047", date: "17-Nov-2026", instrument: "QbD-INST-HPLC-07", stdWt: 25.08, stdAreas: [18744, 18712, 18760, 18731, 18749], sampleWts: [50.66, 50.71], assay: [98.87, 99.13] }), "Assay data entered from HPLC run AM26047-AS-01");
    await submit(id, arjun, meera, "Assay of AM26047 for release");
    await decide(id, meera, "APPROVED", "Verified, forwarded to QA");
    log("QA review: Amlodipine assay");
  }

  // 5. MANAGER REVIEW: Metformin ER development trial
  {
    const id = await newFromTemplate(priya, tHplc, F.d0312, "Assay by HPLC - Metformin HCl ER Tablets - Trial T-07.xlsx");
    await save(id, priya, hplcInputs({ ...std, by: "Priya Analyst", standard: "Metformin HCl WS", stdBatch: "WS/MET/26/003", potency: 99.9, rt: 3.287, product: "Metformin HCl ER Tablets 1000 mg (Trial T-07)", ar: "D20260000312", batch: "T-07", date: "18-Nov-2026", instrument: "QbD-INST-HPLC-07", stdWt: 25.4, stdAreas: [24512, 24538, 24497, 24521, 24530], sampleWts: [51.2, 51.18], assay: [97.95, 98.32] }), "Development trial T-07 assay data");
    await submit(id, priya, meera, "Trial T-07 assay for review");
    log("Manager review: Metformin ER trial");
  }

  // 6. CHANGES REQUESTED by QA: Paracetamol stability 6M
  {
    const id = await newFromTemplate(arjun, tHplc, F.s0145, "Assay by HPLC - Paracetamol Tablets - Stability 6M 40C-75RH.xlsx");
    await save(id, arjun, hplcInputs({ ...std, by: "Arjun Analyst", product: "Paracetamol Tablets IP 500 mg - 6M 40C/75RH", ar: "S20260000145", batch: "PT26031", date: "16-Nov-2026", instrument: "QbD-INST-HPLC-07", stdWt: 25.17, stdAreas: [19960, 19987, 20011, 19975, 19993], sampleWts: [50.97, 51.05], assay: [98.12, 97.86] }), "Stability 6M pull - assay data entered");
    await submit(id, arjun, meera, "6M accelerated stability assay");
    await decide(id, meera, "APPROVED", "OK");
    await annotate(id, qamar, HPLC, "B7", "Batch number of the stability batch is PT26031-S, as per the stability protocol SP-PCM-02.");
    await decide(id, qamar, "CHANGES_REQUESTED", "Batch reference must match the stability protocol");
    log("Changes requested by QA: Paracetamol stability");
  }

  // 7. CHANGES REQUESTED by the manager: Polysorbate 80 GC
  {
    const id = await newFromTemplate(arjun, tGc, F.r2104, "EG-DEG-TEG by GC - Polysorbate 80 - RMB0118219.xlsx");
    await save(id, arjun, gcInputs({ product: "Polysorbate 80", ar: "R20260002104", batch: "RMB0118219", instrument: "QbD-INST-GCALS-40", notebook: "QbD-LNB-G-I-100", page: "074", samples: [
      { sheet: "EG", wt: 4008.6, area: 3.12, is: 131.04, result: "Below LOQ" },
      { sheet: "DEG", wt: 4008.6, area: 0, is: 131.04, result: "Not Detected" },
    ] }), "GC data entered from sequence RMB0118219-GC-01");
    await submit(id, arjun, meera, "Glycol impurities for RM release");
    await annotate(id, meera, "EG", "M35", "A peak was integrated for EG - report the calculated value in ppm instead of 'Below LOQ', or attach the LOQ justification.");
    await decide(id, meera, "CHANGES_REQUESTED", "EG reporting");
    log("Changes requested by manager: Polysorbate 80 GC");
  }

  // 8-10. DRAFTS
  {
    const id = await newFromTemplate(priya, tHplc, F.i0455, "Assay by HPLC - Paracetamol Blend - PT26118.xlsx");
    await save(id, priya, hplcInputs({ ...std, by: "Priya Analyst", product: "Paracetamol Blend (for compression)", ar: "I20260000455", batch: "PT26118", date: "19-Nov-2026", instrument: "QbD-INST-HPLC-07", stdWt: 25.25, stdAreas: [19941, 19968, 19952, 19977, 19960], sampleWts: [50.5, 50.62], assay: [100.84, 100.51] }), "Blend assay data entered");
    await newFromTemplate(priya, tGc, F.r2131, "EG-DEG-TEG by GC - PEG 400 - RMB0118246.xlsx");
    const v = await newFromTemplate(arjun, tHplc, F.v0021, "Assay by HPLC - Atorvastatin - Method Validation Precision.xlsx");
    await save(v, arjun, [
      { sheet: HPLC, cell: "B5", value: "Atorvastatin Calcium Tablets 20 mg - Method precision" },
      { sheet: HPLC, cell: "B6", value: "V20260000021" },
      { sheet: HPLC, cell: "B10", value: "QbD-INST-HPLC-07" },
    ], "Header details entered for method validation");
    log("Drafts: Paracetamol blend, PEG 400 GC, Atorvastatin validation");
  }

  const counts = await q<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM files WHERE deleted_at IS NULL GROUP BY status ORDER BY status",
  );
  console.log("\nDone. Workbooks by status:", Object.fromEntries(counts.map((c) => [c.status, c.n])));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
