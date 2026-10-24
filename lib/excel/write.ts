import "server-only";
import ExcelJS from "exceljs";
import { recalculate } from "./engine";
import { serialToDate } from "./format";
import { resolveInput } from "./input";
import type { CellEdit, CellValue, WorkbookModel } from "./model";
import { loadWorkbook, workbookToModel } from "./parse";

export interface CellChange {
  sheet: string;
  cell: string;
  old: CellValue;
  new: CellValue;
}

export class EditError extends Error {}

function same(a: CellValue, b: CellValue) {
  return (a ?? null) === (b ?? null);
}

/**
 * Apply input-cell edits to a workbook. Only unlocked, non-formula cells may change.
 * Formulas are recalculated and their cached results written so the file opens with
 * correct values everywhere (Excel also recalculates on open).
 */
export async function applyEdits(
  buf: Buffer | Uint8Array,
  edits: CellEdit[],
): Promise<{ buffer: Buffer; model: WorkbookModel; changes: CellChange[] }> {
  const wb = await loadWorkbook(buf);
  const model = workbookToModel(wb);
  const changes: CellChange[] = [];

  for (const e of edits) {
    const sheet = model.sheets.find((s) => s.name === e.sheet);
    if (!sheet) throw new EditError(`Sheet "${e.sheet}" not found`);
    const cm = sheet.cells[e.cell];
    if (!cm || !cm.u) throw new EditError(`Cell ${e.sheet}!${e.cell} is locked and cannot be edited`);
    if (cm.f) throw new EditError(`Cell ${e.sheet}!${e.cell} contains a formula`);
    const nf = cm.s !== undefined ? model.styles[cm.s]?.nf : undefined;
    const { value, isDate } = resolveInput(e.value, cm.d, nf);
    if (same(cm.v, value)) continue;
    changes.push({ sheet: sheet.name, cell: e.cell, old: cm.v, new: value });
    cm.v = value;
    cm.d = isDate || undefined;

    const ws = wb.getWorksheet(sheet.name)!;
    const cell = ws.getCell(e.cell);
    cell.value = value === null ? null : isDate && typeof value === "number" ? serialToDate(value) : value;
  }

  recalculate(model);

  // Write calculated results back into formula cells.
  for (const sheet of model.sheets) {
    const ws = wb.getWorksheet(sheet.name)!;
    for (const [a, cm] of Object.entries(sheet.cells)) {
      if (!cm.f) continue;
      const cell = ws.getCell(a);
      const cur = cell.value as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue | null;
      if (!cur || typeof cur !== "object") continue;
      const result = cm.err ? { error: cm.err } : cm.v === null ? undefined : cm.v;
      cell.value = { ...cur, result } as ExcelJS.CellValue;
    }
  }
  wb.calcProperties.fullCalcOnLoad = true;
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer: out, model, changes };
}

/** Export a workbook with reviewer annotations embedded as Excel notes. */
export async function withNotes(
  buf: Buffer | Uint8Array,
  notes: { sheet: string; cell: string; text: string }[],
): Promise<Buffer> {
  const wb = await loadWorkbook(buf);
  const grouped = new Map<string, string[]>();
  for (const n of notes) {
    const k = `${n.sheet}!${n.cell}`;
    grouped.set(k, [...(grouped.get(k) ?? []), n.text]);
  }
  for (const [k, texts] of grouped) {
    const [sheet, cell] = [k.slice(0, k.lastIndexOf("!")), k.slice(k.lastIndexOf("!") + 1)];
    const ws = wb.getWorksheet(sheet);
    if (!ws) continue;
    ws.getCell(cell).note = texts.join("\n\n");
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
