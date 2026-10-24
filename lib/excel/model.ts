// Serializable workbook model shared by server (parse/write) and browser (render/recalc).

export type CellValue = number | string | boolean | null;

export interface CellStyle {
  b?: boolean; // bold
  i?: boolean; // italic
  u?: boolean; // underline
  sz?: number; // font size (pt)
  fn?: string; // font name
  fc?: string; // font colour (#rrggbb)
  bg?: string; // fill colour
  ha?: string; // horizontal align
  va?: string; // vertical align
  wrap?: boolean;
  bt?: string; // border top  (css shorthand)
  br?: string;
  bb?: string;
  bl?: string;
  nf?: string; // number format
}

export interface CellModel {
  v: CellValue; // value (formula cells: cached/calculated result)
  f?: string; // formula (no leading "=")
  d?: boolean; // value is a date (v is an Excel serial number)
  s?: number; // index into WorkbookModel.styles
  u?: boolean; // unlocked = editable input cell
  err?: string; // formula error text
}

export interface ImageModel {
  dataUrl: string;
  col: number; // 0-based anchor column
  row: number; // 0-based anchor row
  colOff: number; // px
  rowOff: number; // px
  width: number; // px
  height: number; // px
}

export interface SheetModel {
  name: string;
  rows: number;
  cols: number;
  colWidths: number[]; // px, length = cols
  rowHeights: number[]; // px, length = rows
  hiddenCols: number[];
  hiddenRows: number[];
  merges: string[]; // "A1:C3"
  cells: Record<string, CellModel>; // key "B12"
  protected: boolean;
  images: ImageModel[];
}

export interface WorkbookModel {
  sheets: SheetModel[];
  styles: CellStyle[];
}

export interface CellEdit {
  sheet: string;
  cell: string;
  value: CellValue;
}

// ---- address helpers ----
export function colToLetters(col: number): string {
  // 1-based
  let s = "";
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

export function lettersToCol(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function parseAddr(addr: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(addr);
  if (!m) throw new Error(`Bad address ${addr}`);
  return { col: lettersToCol(m[1]), row: parseInt(m[2], 10) };
}

export function addr(row: number, col: number): string {
  return colToLetters(col) + row;
}

export function parseRange(range: string) {
  const [a, b] = range.split(":");
  const s = parseAddr(a);
  const e = parseAddr(b ?? a);
  return {
    top: Math.min(s.row, e.row),
    left: Math.min(s.col, e.col),
    bottom: Math.max(s.row, e.row),
    right: Math.max(s.col, e.col),
  };
}

export function displayValue(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
