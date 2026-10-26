// Check-in integrity rules: input-cell edits pass; formula/locked-cell/protection/sheet tampering is caught.
// Usage: npm run test:integrity
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { diffWorkbooks } from "../lib/excel/diff";
import { parseWorkbook } from "../lib/excel/parse";

let failures = 0;
const check = (ok: boolean, msg: string, extra = "") => {
  console.log(ok ? "  PASS" : "  FAIL", msg, extra);
  if (!ok) failures++;
};

async function tamper(buf: Buffer, fn: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  fn(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  const file = fs.readdirSync("seed").find((f) => f.includes("011"))!;
  const original = fs.readFileSync(path.join("seed", file));
  const before = await parseWorkbook(original);
  const sheet = before.sheets[0].name;
  const run = async (label: string, fn: (wb: ExcelJS.Workbook) => void) => diffWorkbooks(before, await parseWorkbook(await tamper(original, fn)));

  let d = await run("input", (wb) => (wb.getWorksheet(sheet)!.getCell("B6").value = "AR-2026-0555"));
  check(d.violations.length === 0 && d.changes.length === 1 && d.changes[0].cell === "B6", "editing an input cell is allowed and recorded", JSON.stringify(d.changes));

  d = await run("unchanged", () => {});
  check(d.violations.length === 0 && d.changes.length === 0, "re-saving without changes shows no differences");

  d = await run("formula", (wb) => (wb.getWorksheet(sheet)!.getCell("F18").value = 999));
  check(d.violations.some((v) => v.includes("F18")), "overwriting a formula with a number is blocked", d.violations[0]);

  d = await run("formula-edit", (wb) => (wb.getWorksheet(sheet)!.getCell("F18").value = { formula: "B18*2" } as ExcelJS.CellFormulaValue));
  check(d.violations.some((v) => v.includes("F18")), "changing a formula is blocked", d.violations[0]);

  d = await run("locked", (wb) => (wb.getWorksheet(sheet)!.getCell("A5").value = "Product (edited)"));
  check(d.violations.some((v) => v.includes("Locked cell") && v.includes("A5")), "changing a locked label cell is blocked", d.violations[0]);

  d = await run("unlock", (wb) => (wb.getWorksheet(sheet)!.getCell("A5").protection = { locked: false }));
  check(d.violations.some((v) => v.includes("lock setting") && v.includes("A5")), "unlocking a locked cell is blocked", d.violations[0]);

  d = await run("protection", (wb) => wb.getWorksheet(sheet)!.unprotect());
  check(d.violations.some((v) => v.includes("protection")), "removing sheet protection is blocked", d.violations[0]);

  d = await run("sheet", (wb) => wb.addWorksheet("Extra"));
  check(d.violations.some((v) => v.includes("Extra")), "adding a sheet is blocked", d.violations[0]);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll integrity checks passed");
  process.exit(failures ? 1 : 0);
})();
