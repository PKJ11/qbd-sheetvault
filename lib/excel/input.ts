// Input coercion shared by the browser editor and the server save path.
import type { CellValue } from "./model";

/** Coerce raw user input into a cell value. Numbers stay numbers; blanks become null. */
export function coerceInput(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim();
  if (s === "") return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.?\d*|\.\d+)%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  return s.slice(0, 2000);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse dd/mm/yyyy, dd-mmm-yy, yyyy-mm-dd into an Excel serial. */
export function parseDateInput(s: string): number | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
    d = +m[1]; mo = +m[2]; y = +m[3];
  } else if ((m = /^(\d{1,2})[/ .-]([A-Za-z]{3})[A-Za-z]*[/ .-](\d{2,4})$/.exec(s))) {
    d = +m[1]; mo = MONTHS.indexOf(m[2].toLowerCase()) + 1; y = +m[3];
  } else return null;
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

export function isDateFormat(nf: string | undefined): boolean {
  if (!nf) return false;
  const core = nf.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
  return /[dy]/i.test(core) && !/[0#]/.test(core);
}

/** Resolve the value to store for an input cell, handling date-formatted cells. */
export function resolveInput(raw: unknown, wasDate: boolean | undefined, nf: string | undefined): { value: CellValue; isDate: boolean } {
  const value = coerceInput(raw);
  if (typeof value === "string" && (wasDate || isDateFormat(nf))) {
    const serial = parseDateInput(value);
    if (serial !== null) return { value: serial, isDate: true };
  }
  if (typeof value === "number" && (wasDate || isDateFormat(nf)) && value > 59 && value < 2958466 && Number.isInteger(value)) {
    return { value, isDate: true };
  }
  return { value, isDate: false };
}
