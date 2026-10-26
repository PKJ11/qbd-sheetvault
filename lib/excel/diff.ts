import "server-only";
import type { CellValue, WorkbookModel } from "./model";
import type { CellChange } from "./write";

export interface WorkbookDiff {
  changes: CellChange[]; // input-cell value changes (allowed, audited)
  violations: string[]; // changes the template does not allow (block check-in)
}

const norm = (v: CellValue | undefined) => (v === undefined || v === "" ? null : v);

function same(a: CellValue | undefined, b: CellValue | undefined) {
  const x = norm(a), y = norm(b);
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x));
  return x === y;
}

const normFormula = (f: string | undefined) => (f ?? "").replace(/\s+/g, "").replace(/^=/, "").toUpperCase();

/**
 * Compare a checked-in workbook with the version it was checked out from.
 * Only values of unlocked, non-formula cells may change. Formulas, locked cells,
 * cell lock flags, the sheet list and sheet protection must stay as validated.
 */
export function diffWorkbooks(before: WorkbookModel, after: WorkbookModel): WorkbookDiff {
  const changes: CellChange[] = [];
  const violations: string[] = [];
  const afterSheets = new Map(after.sheets.map((s) => [s.name, s]));

  for (const s of after.sheets) if (!before.sheets.some((b) => b.name === s.name)) violations.push(`Sheet "${s.name}" was added or renamed`);

  for (const b of before.sheets) {
    const a = afterSheets.get(b.name);
    if (!a) {
      violations.push(`Sheet "${b.name}" was removed or renamed`);
      continue;
    }
    if (b.protected && !a.protected) violations.push(`Sheet protection was removed from "${b.name}"`);

    const cells = new Set([...Object.keys(b.cells), ...Object.keys(a.cells)]);
    for (const addr of cells) {
      const cb = b.cells[addr], ca = a.cells[addr];
      const ref = `${b.name}!${addr}`;
      const wasInput = !!cb?.u && !cb?.f;
      if (normFormula(cb?.f) !== normFormula(ca?.f)) {
        violations.push(cb?.f ? `Formula in ${ref} was changed or removed` : `A formula was added in ${ref}`);
        continue;
      }
      if (cb?.f) continue; // formula results may legitimately change
      if (!!cb?.u !== !!ca?.u && (cb || ca?.u)) {
        violations.push(`Cell lock setting of ${ref} was changed`);
        continue;
      }
      if (same(cb?.v, ca?.v)) continue;
      if (wasInput) changes.push({ sheet: b.name, cell: addr, old: norm(cb?.v), new: norm(ca?.v) });
      else violations.push(`Locked cell ${ref} was changed`);
    }
  }
  return { changes, violations };
}
