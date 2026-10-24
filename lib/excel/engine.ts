// Formula recalculation for a WorkbookModel. Runs in the browser (live preview)
// and on the server (authoritative results written back into the .xlsx).
import FormulaParser from "fast-formula-parser";
import Operators from "fast-formula-parser/formulas/operators";
import type { CellValue, WorkbookModel } from "./model";
import { addr } from "./model";

// Excel semantics: a blank cell compared with text behaves as "" (so =A1="" is TRUE),
// compared with anything else it behaves as 0. The library always uses 0.
type CompareOp = (v1: unknown, op: string, v2: unknown, a1: boolean, a2: boolean) => boolean;
const Infix = (Operators as unknown as { Infix: { compareOp: CompareOp & { __patched?: boolean } } }).Infix;
if (!Infix.compareOp.__patched) {
  const original = Infix.compareOp;
  const patched: CompareOp & { __patched?: boolean } = (v1, op, v2, a1, a2) => {
    if (v1 == null && !a1 && typeof v2 === "string") v1 = "";
    if (v2 == null && !a2 && typeof v1 === "string") v2 = "";
    return original(v1, op, v2, a1, a2);
  };
  patched.__patched = true;
  Infix.compareOp = patched;
}

const { FormulaHelpers: H, Types, FormulaError } = FormulaParser as unknown as {
  FormulaHelpers: {
    flattenParams: (
      params: unknown[],
      type: number,
      allowUnion: boolean,
      hook: (item: unknown) => void,
    ) => void;
  };
  Types: { NUMBER: number };
  FormulaError: { DIV0: unknown; VALUE: unknown; new (error: string): unknown };
};

export const ERROR_VALUES = ["#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!", "#ERROR!"];
export const isErrorText = (v: unknown) => typeof v === "string" && ERROR_VALUES.includes(v);

function numbers(args: unknown[]): number[] {
  const out: number[] = [];
  H.flattenParams(args, Types.NUMBER, true, (item) => {
    if (typeof item === "number") out.push(item);
  });
  return out;
}

function variance(xs: number[], sample: boolean): number {
  const n = xs.length;
  if (n - (sample ? 1 : 0) <= 0) throw FormulaError.DIV0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - (sample ? 1 : 0));
}

// Legacy / statistical functions missing from fast-formula-parser.
const extraFunctions = {
  STDEV: (...a: unknown[]) => Math.sqrt(variance(numbers(a), true)),
  "STDEV.S": (...a: unknown[]) => Math.sqrt(variance(numbers(a), true)),
  STDEVP: (...a: unknown[]) => Math.sqrt(variance(numbers(a), false)),
  "STDEV.P": (...a: unknown[]) => Math.sqrt(variance(numbers(a), false)),
  VAR: (...a: unknown[]) => variance(numbers(a), true),
  "VAR.S": (...a: unknown[]) => variance(numbers(a), true),
  VARP: (...a: unknown[]) => variance(numbers(a), false),
  "VAR.P": (...a: unknown[]) => variance(numbers(a), false),
  MAX: (...a: unknown[]) => {
    const n = numbers(a);
    return n.length ? Math.max(...n) : 0;
  },
  MIN: (...a: unknown[]) => {
    const n = numbers(a);
    return n.length ? Math.min(...n) : 0;
  },
  MEDIAN: (...a: unknown[]) => {
    const n = numbers(a).sort((x, y) => x - y);
    if (!n.length) throw FormulaError.VALUE;
    const m = Math.floor(n.length / 2);
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  },
};

function errText(e: unknown): string {
  if (e && typeof e === "object" && "_error" in e) return String((e as { _error: string })._error);
  if (e && typeof e === "object" && "error" in e) return String((e as { error: string }).error);
  return "#VALUE!";
}

function isFormulaError(v: unknown): boolean {
  return !!v && typeof v === "object" && ("_error" in (v as object) || "error" in (v as object));
}

/**
 * Recalculate every formula cell in-place. Returns the number of cells evaluated.
 * Evaluation is demand-driven with memoisation, so dependency order does not matter.
 */
export function recalculate(model: WorkbookModel): number {
  const sheetsByName = new Map(model.sheets.map((s) => [s.name.toLowerCase(), s]));
  const done = new Map<string, CellValue>();
  const inProgress = new Set<string>();
  let count = 0;

  const getValue = (sheetName: string, row: number, col: number): CellValue => {
    const sheet = sheetsByName.get(sheetName.toLowerCase());
    if (!sheet) return null;
    const a = addr(row, col);
    const cell = sheet.cells[a];
    if (!cell) return null;
    if (!cell.f) return cell.v;
    const key = sheet.name + "!" + a;
    if (done.has(key)) return done.get(key)!;
    if (inProgress.has(key)) return cell.v; // circular reference: fall back to cached value
    inProgress.add(key);
    let result: CellValue;
    try {
      const r = parserAt(depth++).parse(cell.f, { sheet: sheet.name, row, col });
      if (isFormulaError(r)) {
        cell.err = errText(r);
        result = cell.err;
      } else {
        delete cell.err;
        result = normalise(r);
      }
    } catch (e) {
      cell.err = errText(e);
      result = cell.err;
    } finally {
      depth--;
    }
    inProgress.delete(key);
    cell.v = result;
    done.set(key, result);
    count++;
    return result;
  };

  let depth = 0;
  const previous = active;
  active = {
    cell: ({ sheet, row, col }) => toParser(getValue(sheet, row, col)),
    range: (ref) => {
      const sheet = sheetsByName.get(ref.sheet.toLowerCase());
      const toRow = Math.min(ref.to.row, sheet?.rows ?? 0);
      const toCol = Math.min(ref.to.col, sheet?.cols ?? 0);
      const out: unknown[][] = [];
      for (let r = ref.from.row; r <= toRow; r++) {
        const line: unknown[] = [];
        for (let c = ref.from.col; c <= toCol; c++) {
          line.push(toParser(getValue(ref.sheet, r, c)));
        }
        out.push(line);
      }
      return out;
    },
  };

  try {
    for (const sheet of model.sheets) {
      for (const [a, cell] of Object.entries(sheet.cells)) {
        if (!cell.f) continue;
        const m = /^([A-Z]+)(\d+)$/.exec(a)!;
        let col = 0;
        for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
        getValue(sheet.name, parseInt(m[2], 10), col);
      }
    }
  } finally {
    active = previous;
  }
  return count;
}

type CellRef = { sheet: string; row: number; col: number };
type RangeRef = { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } };
let active: { cell: (ref: CellRef) => unknown; range: (ref: RangeRef) => unknown[][] } | null = null;

// fast-formula-parser is not re-entrant, and evaluating a formula can trigger evaluation of
// the cells it references. Each nesting depth therefore gets its own parser instance.
const parserPool: { parse: (f: string, pos: CellRef) => unknown }[] = [];
function parserAt(depth: number) {
  if (!parserPool[depth]) {
    parserPool[depth] = new FormulaParser({
      functions: extraFunctions,
      onCell: (ref: CellRef) => active!.cell(ref),
      onRange: (ref: RangeRef) => active!.range(ref),
    });
  }
  return parserPool[depth];
}

// Error results travel through formulas as FormulaError objects, as in Excel.
function toParser(v: CellValue): unknown {
  if (v === null) return undefined;
  if (isErrorText(v)) return new FormulaError(v as string);
  return v;
}

function normalise(r: unknown): CellValue {
  if (Array.isArray(r)) return normalise(Array.isArray(r[0]) ? r[0][0] : r[0]);
  if (r === undefined || r === null) return 0; // Excel shows 0 for a reference to an empty cell
  if (typeof r === "number") return Number.isFinite(r) ? r : "#NUM!";
  if (typeof r === "string" || typeof r === "boolean") return r;
  return String(r);
}
