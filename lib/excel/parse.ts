import "server-only";
import ExcelJS from "exceljs";
import { resolveColor } from "./colors";
import { isErrorText } from "./engine";
import type { CellModel, CellStyle, CellValue, ImageModel, SheetModel, WorkbookModel } from "./model";
import { parseRange } from "./model";

const EMU_PER_PX = 9525;
const MAX_ROWS = 400;
const MAX_COLS = 60;

export function dateToSerial(d: Date): number {
  return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

export function colWidthPx(w: number | undefined, fallback: number): number {
  return Math.round((w ?? fallback) * 7 + 5);
}

function borderCss(b: Partial<ExcelJS.Border> | undefined): string | undefined {
  if (!b || !b.style) return undefined;
  const color = resolveColor(b.color) ?? "#000000";
  const width = b.style === "medium" || b.style === "mediumDashed" ? 2 : b.style === "thick" ? 3 : 1;
  const style = b.style.toLowerCase().includes("dash") ? "dashed" : b.style === "dotted" || b.style === "hair" ? "dotted" : b.style === "double" ? "double" : "solid";
  return `${b.style === "double" ? 3 : width}px ${style} ${color}`;
}

function styleOf(cell: ExcelJS.Cell): CellStyle {
  const s: CellStyle = {};
  const font = cell.font;
  if (font) {
    if (font.bold) s.b = true;
    if (font.italic) s.i = true;
    if (font.underline) s.u = true;
    if (font.size) s.sz = font.size;
    if (font.name) s.fn = font.name;
    const fc = resolveColor(font.color);
    if (fc && fc !== "#000000") s.fc = fc;
  }
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (fill && fill.type === "pattern" && fill.pattern === "solid") {
    const bg = resolveColor(fill.fgColor);
    if (bg) s.bg = bg;
  }
  const al = cell.alignment;
  if (al) {
    if (al.horizontal) s.ha = al.horizontal;
    if (al.vertical) s.va = al.vertical;
    if (al.wrapText) s.wrap = true;
  }
  const bd = cell.border;
  if (bd) {
    const t = borderCss(bd.top), r = borderCss(bd.right), b = borderCss(bd.bottom), l = borderCss(bd.left);
    if (t) s.bt = t;
    if (r) s.br = r;
    if (b) s.bb = b;
    if (l) s.bl = l;
  }
  if (cell.numFmt && cell.numFmt !== "General") s.nf = cell.numFmt;
  return s;
}

function plainValue(v: ExcelJS.CellValue): { v: CellValue; d?: boolean } {
  if (v === null || v === undefined) return { v: null };
  if (v instanceof Date) return { v: dateToSerial(v), d: true };
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return { v };
  if (typeof v === "object") {
    if ("richText" in v) return { v: v.richText.map((r) => r.text).join("") };
    if ("text" in v && typeof v.text === "string") return { v: v.text };
    if ("error" in v) return { v: String(v.error) };
    if ("result" in v || "formula" in v || "sharedFormula" in v)
      return plainValue(((v as ExcelJS.CellFormulaValue).result ?? null) as ExcelJS.CellValue);
  }
  return { v: String(v) };
}

export async function loadWorkbook(buf: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS accepts a Node Buffer; copy to avoid aliasing pg bytea buffers.
  await wb.xlsx.load(Buffer.from(buf) as unknown as ExcelJS.Buffer);
  return wb;
}

export async function parseWorkbook(buf: Buffer | Uint8Array): Promise<WorkbookModel> {
  const wb = await loadWorkbook(buf);
  return workbookToModel(wb);
}

export function workbookToModel(wb: ExcelJS.Workbook): WorkbookModel {
  const styles: CellStyle[] = [];
  const styleIndex = new Map<string, number>();
  const intern = (s: CellStyle): number | undefined => {
    const key = JSON.stringify(s);
    if (key === "{}") return undefined;
    let i = styleIndex.get(key);
    if (i === undefined) {
      i = styles.length;
      styles.push(s);
      styleIndex.set(key, i);
    }
    return i;
  };

  const sheets: SheetModel[] = [];
  wb.eachSheet((ws) => {
    if (ws.state === "veryHidden" || ws.state === "hidden") return;
    const cells: Record<string, CellModel> = {};
    let maxRow = 1, maxCol = 1;

    ws.eachRow({ includeEmpty: true }, (row, rn) => {
      if (rn > MAX_ROWS) return;
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        if (cn > MAX_COLS) return;
        if (cell.type === ExcelJS.ValueType.Merge) return;
        const st = styleOf(cell);
        const hasVisual = st.bg || st.bt || st.bb || st.bl || st.br;
        const formula = cell.type === ExcelJS.ValueType.Formula ? cell.formula : undefined;
        const { v, d } = plainValue(cell.value);
        const unlocked = cell.protection?.locked === false;
        if (v === null && !formula && !hasVisual && !unlocked) return;
        const cm: CellModel = { v };
        if (formula) cm.f = formula.replace(/^=/, "");
        if (formula && isErrorText(v)) cm.err = v as string;
        if (d) cm.d = true;
        const si = intern(st);
        if (si !== undefined) cm.s = si;
        if (unlocked) cm.u = true;
        cells[cell.address] = cm;
        if (v !== null || formula || hasVisual) {
          maxRow = Math.max(maxRow, rn);
          maxCol = Math.max(maxCol, cn);
        }
      });
    });

    const merges: string[] = [];
    const mergeMap = (ws as unknown as { _merges: Record<string, { range: string }> })._merges ?? {};
    for (const m of Object.values(mergeMap)) {
      const range = m.range ?? String(m);
      const r = parseRange(range);
      if (r.top > MAX_ROWS || r.left > MAX_COLS) continue;
      merges.push(range);
      maxRow = Math.max(maxRow, Math.min(r.bottom, MAX_ROWS));
      maxCol = Math.max(maxCol, Math.min(r.right, MAX_COLS));
    }

    const rows = Math.min(maxRow + 3, MAX_ROWS);
    const cols = Math.min(maxCol + 1, MAX_COLS);
    const defW = ws.properties.defaultColWidth ?? 8.43;
    const defH = ws.properties.defaultRowHeight ?? 15;
    const colWidths: number[] = [];
    const hiddenCols: number[] = [];
    for (let c = 1; c <= cols; c++) {
      const col = ws.getColumn(c);
      colWidths.push(colWidthPx(col.width, defW));
      if (col.hidden) hiddenCols.push(c);
    }
    const rowHeights: number[] = [];
    const hiddenRows: number[] = [];
    for (let r = 1; r <= rows; r++) {
      const row = ws.getRow(r);
      rowHeights.push(Math.round((row.height ?? defH) * (4 / 3)));
      if (row.hidden) hiddenRows.push(r);
    }

    const images: ImageModel[] = [];
    const colLeft = (c: number) => colWidths.slice(0, c).reduce((a, b) => a + b, 0);
    const rowTop = (r: number) => rowHeights.slice(0, r).reduce((a, b) => a + b, 0);
    for (const img of ws.getImages()) {
      try {
        const media = wb.getImage(Number(img.imageId));
        if (!media?.buffer) continue;
        const tl = img.range.tl as unknown as { nativeCol: number; nativeColOff: number; nativeRow: number; nativeRowOff: number };
        const br = img.range.br as unknown as typeof tl | undefined;
        const x0 = colLeft(tl.nativeCol) + tl.nativeColOff / EMU_PER_PX;
        const y0 = rowTop(tl.nativeRow) + tl.nativeRowOff / EMU_PER_PX;
        let width = 120, height = 60;
        if (br) {
          width = colLeft(br.nativeCol) + br.nativeColOff / EMU_PER_PX - x0;
          height = rowTop(br.nativeRow) + br.nativeRowOff / EMU_PER_PX - y0;
        } else {
          const extent = (img.range as unknown as { ext?: { width: number; height: number } }).ext;
          if (extent) {
            width = extent.width;
            height = extent.height;
          }
        }
        const ext = media.extension === "jpeg" ? "jpeg" : media.extension;
        images.push({
          dataUrl: `data:image/${ext};base64,${Buffer.from(media.buffer as unknown as Uint8Array).toString("base64")}`,
          col: tl.nativeCol,
          row: tl.nativeRow,
          colOff: tl.nativeColOff / EMU_PER_PX,
          rowOff: tl.nativeRowOff / EMU_PER_PX,
          width: Math.max(10, width),
          height: Math.max(10, height),
        });
      } catch {
        // ignore unreadable media
      }
    }

    sheets.push({
      name: ws.name,
      rows,
      cols,
      colWidths,
      rowHeights,
      hiddenCols,
      hiddenRows,
      merges,
      cells,
      protected: !!(ws as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet,
      images,
    });
  });

  const model: WorkbookModel = { sheets, styles };
  return model;
}
