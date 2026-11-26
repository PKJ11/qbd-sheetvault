"use client";

import { ListChecks } from "lucide-react";
import { useState } from "react";
import { Button, Modal } from "./ui";

/** One entry of an audit record's `details.changes`: cell is "Sheet!A1". */
export interface CellChangeEntry {
  cell: string;
  old: unknown;
  new: unknown;
}

export interface ChangeContext {
  who?: string | null;
  when?: string | null;
  reason?: string | null;
  version?: string | null;
  file?: string | null;
}

function splitRef(ref: string): [string, string] {
  const i = ref.lastIndexOf("!");
  return i > 0 ? [ref.slice(0, i), ref.slice(i + 1)] : ["", ref];
}

const shown = (v: unknown) =>
  v === null || v === undefined || v === "" ? <span className="italic text-gray-400">(blank)</span> : <span className="break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>;

/** Short "3 cells changed: D1, E1, F3" line plus a button that opens every cell's old → new value in a modal. */
export function CellChangesButton({ changes, context }: { changes: CellChangeEntry[]; context?: ChangeContext }) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  const cells = changes.map((c) => splitRef(c.cell)[1]);
  const preview = cells.slice(0, 3).join(", ") + (cells.length > 3 ? ` +${cells.length - 3} more` : "");
  const meta = [
    context?.file && ["File", context.file],
    context?.who && ["Changed by", context.who],
    context?.when && ["When", context.when],
    context?.version && ["Version", context.version],
    context?.reason && ["Reason for change", context.reason],
  ].filter(Boolean) as [string, string][];

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-gray-600">
          {changes.length} cell{changes.length === 1 ? "" : "s"} changed: <span className="font-mono">{preview}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800 hover:bg-brand-100"
        >
          <ListChecks size={11} /> View changes
        </button>
      </div>
      {open && (
        <Modal
          title={`Cell changes (${changes.length})`}
          icon={<ListChecks size={15} />}
          width={760}
          onClose={() => setOpen(false)}
          footer={<Button onClick={() => setOpen(false)}>Close</Button>}
        >
          {meta.length > 0 && (
            <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]">
              {meta.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="break-words text-gray-900">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="overflow-hidden rounded border border-gray-200">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="w-10 px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Sheet</th>
                  <th className="px-3 py-2 font-semibold">Cell</th>
                  <th className="px-3 py-2 font-semibold">Old value</th>
                  <th className="px-3 py-2 font-semibold">New value</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => {
                  const [sheet, cell] = splitRef(c.cell);
                  return (
                    <tr key={c.cell + i} className="border-t border-gray-100 align-top">
                      <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-1.5 text-gray-700">{sheet || "—"}</td>
                      <td className="px-3 py-1.5 font-mono font-semibold text-brand-800">{cell}</td>
                      <td className="px-3 py-1.5 text-red-700">{shown(c.old)}</td>
                      <td className="px-3 py-1.5 font-medium text-green-800">{shown(c.new)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

/** A long audit value shown truncated, with a button to read it in full. */
export function LongValue({ label, value, limit = 120 }: { label: string; value: unknown; limit?: number }) {
  const [open, setOpen] = useState(false);
  const text = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  const flat = typeof value === "object" ? JSON.stringify(value) : text;
  if (flat.length <= limit) return <>{flat}</>;
  return (
    <>
      {flat.slice(0, limit)}…{" "}
      <button type="button" onClick={() => setOpen(true)} className="font-semibold text-brand-700 hover:underline">
        View
      </button>
      {open && (
        <Modal title={label} width={680} onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Close</Button>}>
          <pre className="whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-3 font-mono text-[11px]">{text}</pre>
        </Modal>
      )}
    </>
  );
}

export const changesOf = (details: unknown): CellChangeEntry[] | null => {
  const c = (details as { changes?: unknown } | null)?.changes;
  return Array.isArray(c) ? (c as CellChangeEntry[]) : null;
};
