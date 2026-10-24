"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/client";
import { formatValue } from "@/lib/excel/format";
import { addr, colToLetters, parseAddr, parseRange, type CellStyle, type SheetModel } from "@/lib/excel/model";

export type AnnStatus = "OPEN" | "ADDRESSED" | "CLOSED";

interface Props {
  sheet: SheetModel;
  styles: CellStyle[];
  zoom: number;
  selected: string | null;
  onSelect: (a: string) => void;
  canEdit: (a: string) => boolean;
  onCommit: (a: string, raw: string, move: "down" | "right" | "none") => void;
  annotations: Map<string, { status: AnnStatus; title: string }>;
  changed: Set<string>;
  dirty: Set<string>;
  showInputs: boolean;
  version: number; // bump to re-render after model mutation
}

interface Layout {
  rows: number[]; // visible row numbers (1-based)
  cols: number[];
  master: Map<string, { rs: number; cs: number }>;
  covered: Map<string, string>; // covered addr -> master addr
  spill: Set<string>; // text cells allowed to overflow into empty neighbours
  colLeft: number[]; // px offset of each 0-based col
  rowTop: number[];
}

const HEADER_W = 44;
const HEADER_H = 22;

function buildLayout(sheet: SheetModel): Layout {
  const hiddenR = new Set(sheet.hiddenRows);
  const hiddenC = new Set(sheet.hiddenCols);
  const rows = Array.from({ length: sheet.rows }, (_, i) => i + 1).filter((r) => !hiddenR.has(r));
  const cols = Array.from({ length: sheet.cols }, (_, i) => i + 1).filter((c) => !hiddenC.has(c));
  const master = new Map<string, { rs: number; cs: number }>();
  const covered = new Map<string, string>();
  for (const m of sheet.merges) {
    const r = parseRange(m);
    const top = addr(r.top, r.left);
    let rs = 0, cs = 0;
    for (let y = r.top; y <= r.bottom; y++) if (!hiddenR.has(y) && y <= sheet.rows) rs++;
    for (let x = r.left; x <= r.right; x++) if (!hiddenC.has(x) && x <= sheet.cols) cs++;
    master.set(top, { rs: Math.max(1, rs), cs: Math.max(1, cs) });
    for (let y = r.top; y <= r.bottom; y++)
      for (let x = r.left; x <= r.right; x++) if (y !== r.top || x !== r.left) covered.set(addr(y, x), top);
  }
  const spill = new Set<string>();
  for (const [a, c] of Object.entries(sheet.cells)) {
    if (typeof c.v !== "string" || master.has(a)) continue;
    const { row, col } = parseAddr(a);
    const next = sheet.cells[addr(row, col + 1)];
    if (!next || next.v === null || next.v === "") spill.add(a);
  }
  const colLeft: number[] = [0];
  for (let c = 1; c <= sheet.cols; c++) colLeft.push(colLeft[c - 1] + (hiddenC.has(c) ? 0 : sheet.colWidths[c - 1]));
  const rowTop: number[] = [0];
  for (let r = 1; r <= sheet.rows; r++) rowTop.push(rowTop[r - 1] + (hiddenR.has(r) ? 0 : sheet.rowHeights[r - 1]));
  return { rows, cols, master, covered, spill, colLeft, rowTop };
}

function cellCss(s: CellStyle | undefined, isNumber: boolean): React.CSSProperties {
  const css: React.CSSProperties = { fontSize: "11pt", textAlign: isNumber ? "right" : "left", verticalAlign: "bottom" };
  if (!s) return css;
  if (s.b) css.fontWeight = 700;
  if (s.i) css.fontStyle = "italic";
  if (s.u) css.textDecoration = "underline";
  if (s.sz) css.fontSize = `${s.sz}pt`;
  if (s.fn) css.fontFamily = `"${s.fn}", Calibri, sans-serif`;
  if (s.fc) css.color = s.fc;
  if (s.bg) css.background = s.bg;
  if (s.ha && s.ha !== "general") css.textAlign = (s.ha === "centerContinuous" || s.ha === "distributed" ? "center" : s.ha === "fill" ? "left" : s.ha) as React.CSSProperties["textAlign"];
  if (s.va) css.verticalAlign = s.va === "center" || s.va === "distributed" || s.va === "justify" ? "middle" : (s.va as React.CSSProperties["verticalAlign"]);
  if (s.wrap) {
    css.whiteSpace = "pre-wrap";
    css.wordBreak = "break-word";
  }
  if (s.bt) css.borderTop = s.bt;
  if (s.bb) css.borderBottom = s.bb;
  if (s.bl) css.borderLeft = s.bl;
  if (s.br) css.borderRight = s.br;
  return css;
}

function InlineEditor({ initial, onDone }: { initial: string; onDone: (v: string | null, move: "down" | "right" | "none") => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v, "none")}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(v, "down");
        else if (e.key === "Tab") {
          e.preventDefault();
          onDone(v, "right");
        } else if (e.key === "Escape") onDone(null, "none");
      }}
      className="absolute inset-0 z-10 w-full border-2 border-[#217346] bg-white px-1 text-[inherit] outline-none"
      style={{ font: "inherit", textAlign: "inherit" }}
    />
  );
}

export const SheetGrid = memo(function SheetGrid(p: Props) {
  const { sheet, styles, selected } = p;
  const layout = useMemo(() => buildLayout(sheet), [sheet]);
  const [editing, setEditing] = useState<{ a: string; initial: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sel = selected ? parseAddr(selected) : null;
  const selMaster = selected ? layout.master.get(selected) : undefined;

  // Keep selection in view.
  useEffect(() => {
    if (!selected || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-a="${selected}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const move = (a: string, dr: number, dc: number) => {
    const { row, col } = parseAddr(a);
    const m = layout.master.get(a);
    let r = row, c = col;
    const ri = layout.rows.indexOf(row), ci = layout.cols.indexOf(col);
    if (dr) {
      const span = dr > 0 && m ? m.rs : 1;
      r = layout.rows[Math.max(0, Math.min(layout.rows.length - 1, ri + dr * span))] ?? row;
    }
    if (dc) {
      const span = dc > 0 && m ? m.cs : 1;
      c = layout.cols[Math.max(0, Math.min(layout.cols.length - 1, ci + dc * span))] ?? col;
    }
    const target = addr(r, c);
    return layout.covered.get(target) ?? target;
  };

  const startEdit = (a: string, initial?: string) => {
    if (!p.canEdit(a)) return;
    const c = sheet.cells[a];
    const cur = c?.v === null || c?.v === undefined ? "" : c.d ? formatValue(c.v, undefined, true) : String(c.v);
    setEditing({ a, initial: initial ?? cur });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!selected || editing) return;
    const k = e.key;
    const nav: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], Enter: [1, 0], Tab: [0, e.shiftKey ? -1 : 1] };
    if (nav[k]) {
      e.preventDefault();
      p.onSelect(move(selected, nav[k][0], nav[k][1]));
    } else if (k === "F2") {
      e.preventDefault();
      startEdit(selected);
    } else if ((k === "Delete" || k === "Backspace") && p.canEdit(selected)) {
      e.preventDefault();
      p.onCommit(selected, "", "none");
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && p.canEdit(selected)) {
      e.preventDefault();
      startEdit(selected, k);
    }
  };

  const widthPx = layout.cols.reduce((a, c) => a + sheet.colWidths[c - 1], HEADER_W);
  const selRows = new Set<number>();
  const selCols = new Set<number>();
  if (sel) {
    const rs = selMaster?.rs ?? 1, cs = selMaster?.cs ?? 1;
    for (let i = layout.rows.indexOf(sel.row); i >= 0 && i < layout.rows.indexOf(sel.row) + rs; i++) selRows.add(layout.rows[i]);
    for (let i = layout.cols.indexOf(sel.col); i >= 0 && i < layout.cols.indexOf(sel.col) + cs; i++) selCols.add(layout.cols[i]);
  }

  return (
    <div ref={box} tabIndex={0} onKeyDown={onKey} className="relative h-full overflow-auto bg-white outline-none">
      <div style={{ zoom: p.zoom, width: widthPx }} className="relative">
        <table className="sheet-grid" style={{ width: widthPx }}>
          <colgroup>
            <col style={{ width: HEADER_W }} />
            {layout.cols.map((c) => (
              <col key={c} style={{ width: sheet.colWidths[c - 1] }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: HEADER_H }}>
              <th className="corner" />
              {layout.cols.map((c) => (
                <th key={c} className={cx(selCols.has(c) && "hl")}>
                  {colToLetters(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layout.rows.map((r) => (
              <tr key={r} style={{ height: sheet.rowHeights[r - 1] }}>
                <th className={cx(selRows.has(r) && "hl")}>{r}</th>
                {layout.cols.map((c) => {
                  const a = addr(r, c);
                  if (layout.covered.has(a)) return null;
                  const cell = sheet.cells[a];
                  const st = cell?.s !== undefined ? styles[cell.s] : undefined;
                  const m = layout.master.get(a);
                  const isNum = typeof cell?.v === "number";
                  const css = cellCss(st, isNum);
                  const text = cell ? (cell.err ? cell.err : formatValue(cell.v, st?.nf, cell.d)) : "";
                  const editableHere = !!cell?.u && p.canEdit(a);
                  const ann = p.annotations.get(`${sheet.name}!${a}`);
                  const isSel = selected === a;
                  const spill = layout.spill.has(a) && !st?.wrap;
                  return (
                    <td
                      key={a}
                      data-a={a}
                      rowSpan={m?.rs}
                      colSpan={m?.cs}
                      style={{ ...css, overflow: spill ? "visible" : "hidden" }}
                      title={ann?.title ?? (cell?.f ? `=${cell.f}` : undefined)}
                      className={cx(
                        isSel && "cell-sel",
                        p.showInputs && editableHere && "cell-input",
                        p.changed.has(a) && "cell-changed",
                        ann && `cell-ann-${ann.status.toLowerCase()}`,
                        cell?.err && "cell-error",
                      )}
                      onMouseDown={() => p.onSelect(a)}
                      onDoubleClick={() => startEdit(a)}
                    >
                      {p.dirty.has(a) && <span className="absolute left-0 top-0 h-1.5 w-1.5 bg-blue-500" />}
                      <span className={spill ? "relative z-[1]" : undefined}>{text}</span>
                      {editing?.a === a && (
                        <InlineEditor
                          initial={editing.initial}
                          onDone={(v, mv) => {
                            setEditing(null);
                            if (v !== null) p.onCommit(a, v, mv);
                            if (mv !== "none") p.onSelect(move(a, mv === "down" ? 1 : 0, mv === "right" ? 1 : 0));
                            box.current?.focus();
                          }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.images.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={img.dataUrl}
            alt=""
            className="pointer-events-none absolute"
            style={{
              left: HEADER_W + layout.colLeft[img.col] + img.colOff,
              top: HEADER_H + layout.rowTop[img.row] + img.rowOff,
              width: img.width,
              height: img.height,
            }}
          />
        ))}
      </div>
    </div>
  );
});
