"use client";

import { CheckCircle2, CircleDot, MessageSquarePlus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, inputCls, useToast } from "../ui";
import type { Annotation, AnnotationMessage } from "./types";
import { api, cx, fmtDate } from "@/lib/client";

const STATUS = {
  OPEN: { label: "Open", cls: "bg-red-50 text-red-700 border-red-200", icon: CircleDot },
  ADDRESSED: { label: "Addressed", cls: "bg-amber-50 text-amber-800 border-amber-200", icon: MessageSquarePlus },
  CLOSED: { label: "Closed", cls: "bg-green-50 text-green-700 border-green-200", icon: CheckCircle2 },
} as const;

const KIND_LABEL = { COMMENT: "commented", RESPONSE: "responded", REOPEN: "re-opened", CLOSE: "closed" } as const;

export function AnnotationsPanel({
  fileId,
  annotations,
  messages,
  activeReviewId,
  canAnnotate,
  canRespond,
  selectedCell,
  onJump,
  onChanged,
  currentUserId,
  sheetNames,
}: {
  /** When set (Excel editor view), the reviewer types the cell reference instead of clicking it. */
  sheetNames?: string[];
  fileId: number;
  annotations: Annotation[];
  messages: AnnotationMessage[];
  activeReviewId: number | null;
  canAnnotate: boolean;
  canRespond: boolean;
  selectedCell: { sheet: string; cell: string } | null;
  onJump: (sheet: string, cell: string) => void;
  onChanged: () => void;
  currentUserId: number;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "ADDRESSED" | "CLOSED">("ALL");
  const [text, setText] = useState("");
  const [pin, setPin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [typedSheet, setTypedSheet] = useState(sheetNames?.[0] ?? "");
  const [typedCell, setTypedCell] = useState("");
  const typed = typedCell.trim().toUpperCase().replace(/\$/g, "");
  const typedValid = /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(typed);
  const target = sheetNames ? (typedValid ? { sheet: typedSheet || sheetNames[0], cell: typed } : null) : selectedCell;

  const run =async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await api(`/api/files/${fileId}/annotations`, {
        body: { sheet: pin && target ? target.sheet : null, cell: pin && target ? target.cell : null, comment: text },
      });
      setText("");
      setTypedCell("");
    }, "Annotation added");

  const act = (id: number, action: "respond" | "close" | "reopen", t?: string) =>
    run(async () => {
      await api(`/api/annotations/${id}`, { method: "PATCH", body: { action, text: t } });
      setReplyFor(null);
      setReply("");
    }, action === "respond" ? "Response saved" : action === "close" ? "Annotation closed" : "Annotation re-opened");

  const counts = { OPEN: 0, ADDRESSED: 0, CLOSED: 0 };
  annotations.forEach((a) => counts[a.status]++);
  const shown = annotations.filter((a) => filter === "ALL" || a.status === filter);

  return (
    <div className="flex h-full flex-col">
      {canAnnotate && (
        <div className="border-b border-gray-200 bg-amber-50/60 p-3">
          <div className="mb-1.5 text-xs font-semibold text-gray-800">Add annotation</div>
          <textarea className={cx(inputCls, "text-xs")} rows={3} placeholder="Describe the issue or the change required…" value={text} onChange={(e) => setText(e.target.value)} />
          {sheetNames && (
            <div className="mt-2 flex items-center gap-1.5">
              {sheetNames.length > 1 && (
                <select className={cx(inputCls, "h-7 w-28 py-0 text-xs")} value={typedSheet} onChange={(e) => setTypedSheet(e.target.value)}>
                  {sheetNames.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              )}
              <input className={cx(inputCls, "h-7 w-24 py-0 font-mono text-xs uppercase")} placeholder="Cell e.g. B18" value={typedCell} onChange={(e) => setTypedCell(e.target.value)} />
              {typedCell && !typedValid && <span className="text-[10px] text-red-600">invalid cell</span>}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
              <input type="checkbox" className="accent-brand-700" checked={pin} onChange={(e) => setPin(e.target.checked)} disabled={!target} />
              {target ? (
                <>
                  Pin to cell <b>{target.sheet}!{target.cell}</b>
                </>
              ) : sheetNames ? (
                "Type a cell to pin (or leave general)"
              ) : (
                "Select a cell to pin (or leave general)"
              )}
            </label>
            <Button size="sm" variant="primary" disabled={busy || text.trim().length < 2} onClick={add}>
              Add
            </Button>
          </div>
        </div>
      )}
      <div className="flex gap-1 border-b border-gray-200 px-3 py-2">
        {(["ALL", "OPEN", "ADDRESSED", "CLOSED"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx("rounded-full px-2.5 py-0.5 text-[11px]", filter === f ? "bg-brand-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}>
            {f === "ALL" ? `All ${annotations.length}` : `${STATUS[f].label} ${counts[f]}`}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3">
        {shown.length === 0 && <div className="py-8 text-center text-xs text-gray-400">No annotations.</div>}
        {shown.map((a) => {
          const S = STATUS[a.status];
          const thread = messages.filter((m) => m.annotation_id === a.id);
          const canDelete = canAnnotate && a.status === "OPEN" && a.review_id === activeReviewId && a.created_by === currentUserId;
          return (
            <div key={a.id} className={cx("rounded-lg border bg-white p-2.5 text-xs shadow-sm", selectedCell && a.cell === selectedCell.cell && a.sheet === selectedCell.sheet ? "border-brand-500 ring-1 ring-brand-300" : "border-gray-200")}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold", S.cls)}>
                  <S.icon size={11} /> {S.label}
                </span>
                {a.cell ? (
                  <button className="font-mono text-[11px] font-semibold text-brand-700 hover:underline" onClick={() => onJump(a.sheet!, a.cell!)}>
                    {a.sheet}!{a.cell}
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-500">General</span>
                )}
                <span className="ml-auto text-[10px] text-gray-400">#{a.id} · v{a.version_no}</span>
              </div>
              <div className="space-y-1.5">
                {(thread.length ? thread : [{ id: 0, kind: "COMMENT", text: a.comment, by_name: a.created_by_name, created_at: a.created_at, version_no: a.version_no } as AnnotationMessage]).map((m) => (
                  <div key={m.id} className={cx("rounded px-2 py-1.5", m.kind === "RESPONSE" ? "bg-blue-50" : m.kind === "COMMENT" ? "bg-gray-50" : "bg-amber-50")}>
                    <div className="mb-0.5 text-[10px] text-gray-500">
                      <b className="text-gray-700">{m.by_name}</b> {KIND_LABEL[m.kind]} · {fmtDate(m.created_at)}
                    </div>
                    {m.text && <div className="whitespace-pre-wrap text-gray-800">{m.text}</div>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-1">
                {canRespond && a.status !== "CLOSED" && replyFor !== a.id && (
                  <Button size="sm" onClick={() => (setReplyFor(a.id), setReply(a.response ?? ""))}>
                    {a.status === "ADDRESSED" ? "Edit response" : "Respond"}
                  </Button>
                )}
                {canAnnotate && a.status !== "CLOSED" && (
                  <Button size="sm" disabled={busy} onClick={() => act(a.id, "close")}>
                    <CheckCircle2 size={13} /> Close
                  </Button>
                )}
                {canAnnotate && a.status !== "OPEN" && replyFor !== a.id && (
                  <Button size="sm" onClick={() => (setReplyFor(a.id), setReply(""))}>
                    <RotateCcw size={13} /> Re-open
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api(`/api/annotations/${a.id}`, { method: "DELETE" }), "Annotation deleted")}>
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
              {replyFor === a.id && (
                <div className="mt-2">
                  <textarea className={cx(inputCls, "text-xs")} rows={3} autoFocus placeholder={canRespond ? "How was this addressed?" : "Why is this re-opened?"} value={reply} onChange={(e) => setReply(e.target.value)} />
                  <div className="mt-1 flex justify-end gap-1">
                    <Button size="sm" onClick={() => setReplyFor(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" disabled={busy || reply.trim().length < 2} onClick={() => act(a.id, canRespond ? "respond" : "reopen", reply)}>
                      {canRespond ? "Save response" : "Re-open"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
