"use client";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileText,
  History,
  ListChecks,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Save,
  Send,
  Undo2,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../AppShell";
import { ExcelIcon } from "../icons";
import { Button, ReasonDialog, StatusBadge, useToast } from "../ui";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { SheetGrid, type AnnStatus } from "./SheetGrid";
import { SubmitDialog } from "./SubmitDialog";
import type { AnnotationMessage, FileData } from "./types";
import { api, cx, fmtBytes, fmtDate } from "@/lib/client";
import { recalculate } from "@/lib/excel/engine";
import { formatValue } from "@/lib/excel/format";
import { resolveInput } from "@/lib/excel/input";
import type { WorkbookModel } from "@/lib/excel/model";

type Panel = "annotations" | "changes" | "versions" | "activity";
interface AuditRow {
  id: string;
  ts: string;
  user_name: string;
  employee_id: string;
  action: string;
  details: Record<string, unknown> | null;
  reason: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  FILE_UPLOADED: "Uploaded",
  FILE_CREATED_FROM_TEMPLATE: "Created from template",
  FILE_EDITED: "Edited",
  FILE_RENAMED: "Renamed",
  FILE_SUBMITTED_FOR_REVIEW: "Submitted for review",
  FILE_RESUBMITTED: "Resubmitted",
  CHANGES_REQUESTED: "Changes requested",
  FILE_APPROVED: "Approved",
  REVIEW_WITHDRAWN: "Review withdrawn",
  REVISION_STARTED: "Revision started",
  ANNOTATION_ADDED: "Annotation added",
  ANNOTATION_RESPONDED: "Annotation responded",
  ANNOTATION_CLOSED: "Annotation closed",
  ANNOTATION_REOPENED: "Annotation re-opened",
  ANNOTATION_DELETED: "Annotation deleted",
  FILE_DOWNLOADED: "Downloaded",
  PERMISSIONS_CHANGED: "Permissions changed",
  FILE_DELETED: "Deleted",
  FILE_RESTORED: "Restored",
  ESIGNATURE_FAILED: "E-signature failed",
};

export function LoadingWorkbook() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-gray-500">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-700" />
      Opening workbook…
    </div>
  );
}

export function SheetEditor({ id }: { id: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { user, refreshBadges } = useMe();
  const vParam = params.get("v");

  const [data, setData] = useState<FileData | null>(null);
  const [error, setError] = useState("");
  const [model, setModel] = useState<WorkbookModel | null>(null);
  const [version, setVersion] = useState(0);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  const [zoom, setZoom] = useState(0.8);
  const [panel, setPanel] = useState<Panel>("annotations");
  const [panelOpen, setPanelOpen] = useState(true);
  const [messages, setMessages] = useState<AnnotationMessage[]>([]);
  const [activity, setActivity] = useState<AuditRow[] | null>(null);
  const [showChanged, setShowChanged] = useState(true);
  const [dialog, setDialog] = useState<null | "save" | "submit" | "approve" | "reject" | "withdraw" | "revise">(null);
  const [dlMenu, setDlMenu] = useState(false);
  const formulaRef = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<FileData>(`/api/files/${id}${vParam ? `?v=${vParam}` : ""}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setModel(structuredClone(d.model));
        setPending(new Map());
        setVersion((v) => v + 1);
        setSheetIdx((i) => Math.min(i, d.model.sheets.length - 1));
        setMessages(d.messages);
        setActivity(null);
        setError("");
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id, vParam, reloadKey]);

  useEffect(() => {
    if (panel === "activity" && !activity)
      api<{ rows: AuditRow[] }>(`/api/audit?entityType=file&entityId=${id}&size=200`).then((r) => setActivity(r.rows)).catch(() => setActivity([]));
  }, [panel, activity, id]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.size]);

  const sheet = model?.sheets[sheetIdx];
  const f = data?.file;
  const isLatest = !!data && data.versionNo === data.file.current_version;
  const canEditFile = !!data && isLatest && data.perms.includes("edit") && (f!.status === "DRAFT" || f!.status === "CHANGES_REQUESTED");
  const isReviewer = !!data && data.isReviewer && f!.status === "IN_REVIEW" && isLatest;
  const canRespond = !!data && data.perms.includes("edit") && f!.status === "CHANGES_REQUESTED";
  const openAnns = data?.annotations.filter((a) => a.status === "OPEN").length ?? 0;
  const addressedAnns = data?.annotations.filter((a) => a.status === "ADDRESSED").length ?? 0;

  const annMap = useMemo(() => {
    const m = new Map<string, { status: AnnStatus; title: string }>();
    const rank = { OPEN: 3, ADDRESSED: 2, CLOSED: 1 };
    for (const a of data?.annotations ?? []) {
      if (!a.cell) continue;
      const k = `${a.sheet}!${a.cell}`;
      const prev = m.get(k);
      const title = `${prev ? prev.title + "\n\n" : ""}[${a.status}] ${a.created_by_name}: ${a.comment}${a.response ? `\n↳ ${a.response}` : ""}`;
      m.set(k, { status: !prev || rank[a.status] > rank[prev.status] ? a.status : prev.status, title });
    }
    return m;
  }, [data]);

  const changedSet = useMemo(() => {
    const s = new Set<string>();
    if (showChanged && sheet) for (const c of data?.changedSinceReview ?? []) if (c.sheet === sheet.name) s.add(c.cell);
    return s;
  }, [data, sheet, showChanged]);

  const dirtySet = useMemo(() => {
    const s = new Set<string>();
    if (sheet) for (const k of pending.keys()) if (k.startsWith(sheet.name + "!")) s.add(k.slice(sheet.name.length + 1));
    return s;
  }, [pending, sheet]);

  const canEditCell = useCallback((a: string) => canEditFile && !!sheet?.cells[a]?.u && !sheet?.cells[a]?.f, [canEditFile, sheet]);

  const commit = useCallback(
    (a: string, raw: string) => {
      if (!model || !sheet || !data) return;
      if (!sheet.cells[a]?.u) return;
      const original = data.model.sheets[sheetIdx].cells[a];
      const next = structuredClone(model);
      const cell = next.sheets[sheetIdx].cells[a];
      const nf = cell.s !== undefined ? next.styles[cell.s]?.nf : undefined;
      const { value, isDate } = resolveInput(raw, original?.d, nf);
      cell.v = value;
      cell.d = isDate || undefined;
      recalculate(next);
      setModel(next);
      const key = `${sheet.name}!${a}`;
      setPending((p) => {
        const n = new Map(p);
        if ((original?.v ?? null) === (value ?? null)) n.delete(key);
        else n.set(key, raw);
        return n;
      });
      setVersion((v) => v + 1);
    },
    [model, sheet, data, sheetIdx],
  );

  const discard = () => {
    if (!data) return;
    setModel(structuredClone(data.model));
    setPending(new Map());
    setVersion((v) => v + 1);
  };

  const jump = (sheetName: string, cell: string) => {
    const i = model?.sheets.findIndex((s) => s.name === sheetName) ?? -1;
    if (i >= 0) setSheetIdx(i);
    setSel(cell);
  };

  if (error)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <XCircle className="text-red-500" size={40} />
        <div className="font-semibold">{error}</div>
        <Button onClick={() => router.push("/explorer")}>Back to File Explorer</Button>
      </div>
    );
  if (!data || !model || !sheet || !f) return <LoadingWorkbook />;

  const selCell = sel ? sheet.cells[sel] : undefined;
  const selStyle = selCell?.s !== undefined ? model.styles[selCell.s] : undefined;
  const formulaText = selCell ? (selCell.f ? `=${selCell.f}` : selCell.d ? formatValue(selCell.v, selStyle?.nf, true) : selCell.v === null ? "" : String(selCell.v)) : "";
  const selAnns = sel ? data.annotations.filter((a) => a.sheet === sheet.name && a.cell === sel) : [];

  const tab = (p: Panel, label: string, Icon: React.ComponentType<{ size?: number }>, count?: number) => (
    <button onClick={() => (setPanel(p), setPanelOpen(true))} className={cx("flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2 text-[11px] font-medium", panel === p ? "border-brand-700 text-brand-800" : "border-transparent text-gray-500 hover:text-gray-800")}>
      <Icon size={13} /> {label}
      {!!count && <span className="rounded-full bg-gray-200 px-1.5 text-[10px]">{count}</span>}
    </button>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 flex flex-col overflow-hidden bg-page">
      {/* File header */}
      <div className="border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href={`/explorer?folder=${f.folder_id}`} className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-700">
            <ArrowLeft size={14} /> {["SheetVault", ...data.path.map((p) => p.name)].join(" › ")}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <ExcelIcon size={26} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-gray-900">{f.name}</h1>
              <StatusBadge status={f.status} />
            </div>
            <div className="text-[11px] text-gray-500">
              v{data.versionNo}
              {!isLatest && ` of ${f.current_version}`} · saved {fmtDate(data.version.created_at)} by {data.version.by} · Author: {f.owner_name}
              {data.activeReview && ` · Reviewer: ${data.activeReview.reviewer_name}`}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEditFile && pending.size > 0 && (
              <>
                <span className="text-xs font-medium text-blue-700">{pending.size} unsaved change{pending.size > 1 ? "s" : ""}</span>
                <Button size="sm" onClick={discard}>
                  <Undo2 size={14} /> Discard
                </Button>
                <Button size="sm" variant="primary" onClick={() => setDialog("save")}>
                  <Save size={14} /> Save version
                </Button>
              </>
            )}
            {canEditFile && pending.size === 0 && (
              <Button size="sm" variant="primary" onClick={() => setDialog("submit")} title={openAnns ? "Respond to all open annotations first" : undefined}>
                <Send size={14} /> {f.status === "CHANGES_REQUESTED" ? "Resubmit for review" : "Submit for review"}
              </Button>
            )}
            {isReviewer && (
              <>
                <Button size="sm" variant="danger" onClick={() => setDialog("reject")}>
                  <XCircle size={14} /> Request changes
                </Button>
                <Button size="sm" variant="primary" onClick={() => setDialog("approve")}>
                  <CheckCircle2 size={14} /> Approve
                </Button>
              </>
            )}
            {f.status === "IN_REVIEW" && isLatest && data.activeReview && (data.activeReview.submitted_by === user.id || data.isOwner) && (
              <Button size="sm" onClick={() => setDialog("withdraw")}>
                <Undo2 size={14} /> Withdraw
              </Button>
            )}
            {f.status === "APPROVED" && isLatest && data.perms.includes("edit") && (
              <Button size="sm" onClick={() => setDialog("revise")}>
                <RotateCcw size={14} /> Start new revision
              </Button>
            )}
            <div className="relative">
              <Button size="sm" onClick={() => setDlMenu((m) => !m)}>
                <Download size={14} /> Download <ChevronDown size={12} />
              </Button>
              {dlMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setDlMenu(false)} />
                  <div className="win-menu absolute right-0 z-40 mt-1">
                    <a className="win-menu-item" href={`/api/files/${id}/download?v=${data.versionNo}`} onClick={() => setDlMenu(false)}>
                      <Download size={14} /> Excel workbook (v{data.versionNo})
                    </a>
                    <a className="win-menu-item" href={`/api/files/${id}/download?v=${data.versionNo}&annotations=1`} onClick={() => setDlMenu(false)}>
                      <MessageSquare size={14} /> With annotations as cell notes
                    </a>
                  </div>
                </>
              )}
            </div>
            <Link href={`/files/${id}/report`}>
              <Button size="sm">
                <FileText size={14} /> Report
              </Button>
            </Link>
          </div>
        </div>
        {!isLatest && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800">
            <Eye size={14} /> You are viewing version {data.versionNo} (read-only).
            <Link className="font-semibold underline" href={`/files/${id}`}>
              Go to current version (v{f.current_version})
            </Link>
          </div>
        )}
        {isLatest && f.status === "CHANGES_REQUESTED" && data.perms.includes("edit") && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            The reviewer requested changes. Update the input cells, save a new version, respond to each open annotation ({openAnns} open), then resubmit.
          </div>
        )}
        {isReviewer && (
          <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-900">
            You are the reviewer. Select a cell and add annotations in the side panel. {addressedAnns > 0 && `${addressedAnns} annotation(s) were addressed by the author — close or re-open them.`} Cells changed since the last review are outlined in blue.
          </div>
        )}
      </div>

      {/* Formula bar */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-[#f8f9fa] px-3 py-1 text-[12px]">
        <div className="w-28 shrink-0 rounded border border-gray-300 bg-white px-2 py-0.5 font-mono text-[11px]">{sel ? `${sheet.name}!${sel}` : ""}</div>
        <span className="font-serif italic text-gray-500">fx</span>
        <input
          ref={formulaRef}
          key={`${sheet.name}!${sel}!${version}`}
          className={cx("min-w-0 flex-1 rounded border border-gray-300 px-2 py-0.5 font-mono text-[12px]", sel && canEditCell(sel) ? "bg-white" : "bg-gray-50 text-gray-600")}
          defaultValue={formulaText}
          readOnly={!sel || !canEditCell(sel)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && sel && canEditCell(sel)) commit(sel, (e.target as HTMLInputElement).value);
          }}
          onBlur={(e) => {
            if (sel && canEditCell(sel) && e.target.value !== formulaText) commit(sel, e.target.value);
          }}
        />
        {selCell && (
          <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", selCell.u && !selCell.f ? "bg-brand-100 text-brand-800" : "bg-gray-200 text-gray-600")}>
            {selCell.f ? "Formula (locked)" : selCell.u ? (canEditFile ? "Input cell" : "Input cell (read-only now)") : "Locked"}
          </span>
        )}
        {selAnns.length > 0 && <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{selAnns.length} annotation(s)</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <SheetGrid
              key={sheet.name}
              sheet={sheet}
              styles={model.styles}
              zoom={zoom}
              selected={sel}
              onSelect={setSel}
              canEdit={canEditCell}
              onCommit={commit}
              annotations={annMap}
              changed={changedSet}
              dirty={dirtySet}
              showInputs={canEditFile}
              version={version}
            />
          </div>
          {/* Sheet tabs + zoom */}
          <div className="flex h-8 items-center border-t border-gray-300 bg-[#f3f3f3] text-[12px]">
            <div className="flex h-full min-w-0 flex-1 overflow-x-auto">
              {model.sheets.map((s, i) => (
                <button
                  key={s.name}
                  onClick={() => (setSheetIdx(i), setSel(null))}
                  className={cx("h-full whitespace-nowrap border-r border-gray-300 px-4", i === sheetIdx ? "border-b-2 border-b-[#217346] bg-white font-semibold text-[#217346]" : "hover:bg-gray-200")}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 px-2 text-[11px] text-gray-600">
              <input type="checkbox" className="accent-blue-600" checked={showChanged} onChange={(e) => setShowChanged(e.target.checked)} /> Highlight changes
            </label>
            <div className="flex items-center gap-1 px-3">
              <button className="win-icon-btn h-6 w-6" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}>
                <ZoomOut size={14} />
              </button>
              <span className="w-10 text-center text-[11px]">{Math.round(zoom * 100)}%</span>
              <button className="win-icon-btn h-6 w-6" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>
                <ZoomIn size={14} />
              </button>
            </div>
            <button className="win-icon-btn mr-1 h-6 w-6" title={panelOpen ? "Hide panel" : "Show panel"} onClick={() => setPanelOpen((o) => !o)}>
              {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
          </div>
        </div>

        {panelOpen && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-gray-200 bg-[#fafafa] max-lg:hidden">
            <div className="flex border-b border-gray-200 bg-white">
              {tab("annotations", "Annotations", MessageSquare, openAnns + addressedAnns)}
              {tab("changes", "Changes", ListChecks, data.changedSinceReview.length)}
              {tab("versions", "Versions", History, data.versions.length)}
              {tab("activity", "Activity", FileText)}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {panel === "annotations" && (
                <AnnotationsPanel
                  fileId={id}
                  annotations={data.annotations}
                  messages={messages}
                  activeReviewId={data.activeReview?.id ?? null}
                  canAnnotate={isReviewer}
                  canRespond={canRespond && isLatest}
                  selectedCell={sel ? { sheet: sheet.name, cell: sel } : null}
                  onJump={jump}
                  onChanged={() => (load(), refreshBadges())}
                  currentUserId={user.id}
                />
              )}
              {panel === "changes" && (
                <div className="p-3 text-xs">
                  <p className="mb-2 text-gray-500">
                    {data.lastReviewedVersion ? `Input cells changed since v${data.lastReviewedVersion} (last reviewed version).` : "No completed review yet — changes are listed after the first review."}
                  </p>
                  {data.changedSinceReview.map((c) => (
                    <button key={c.sheet + c.cell} onClick={() => jump(c.sheet, c.cell)} className="mb-1 block w-full rounded border border-gray-200 bg-white p-2 text-left hover:border-brand-400">
                      <div className="font-mono font-semibold text-brand-700">
                        {c.sheet}!{c.cell} <span className="font-sans font-normal text-gray-400">v{c.version_no}</span>
                      </div>
                      <div className="mt-0.5 text-gray-700">
                        <span className="text-red-600 line-through">{c.old_value ?? "(blank)"}</span> → <span className="font-semibold text-green-700">{c.new_value ?? "(blank)"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {panel === "versions" && (
                <div className="p-3 text-xs">
                  {data.versions.map((v) => (
                    <div key={v.version_no} className={cx("mb-1.5 rounded border bg-white p-2", v.version_no === data.versionNo ? "border-brand-500" : "border-gray-200")}>
                      <div className="flex items-center justify-between">
                        <b>Version {v.version_no}</b>
                        <span className="text-gray-400">{fmtBytes(v.size_bytes)}</span>
                      </div>
                      <div className="text-gray-500">
                        {fmtDate(v.created_at)} · {v.by} ({v.employee_id})
                      </div>
                      {v.reason && <div className="mt-1 text-gray-700">“{v.reason}”</div>}
                      <div className="mt-1 truncate font-mono text-[9px] text-gray-400" title={v.sha256}>
                        SHA-256 {v.sha256}
                      </div>
                      <div className="mt-1.5 flex gap-2">
                        {v.version_no !== data.versionNo && (
                          <Link className="font-medium text-brand-700 hover:underline" href={v.version_no === f.current_version ? `/files/${id}` : `/files/${id}?v=${v.version_no}`}>
                            View
                          </Link>
                        )}
                        <a className="font-medium text-brand-700 hover:underline" href={`/api/files/${id}/download?v=${v.version_no}`}>
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {panel === "activity" && (
                <div className="p-3 text-xs">
                  {!activity && <div className="text-gray-400">Loading…</div>}
                  {activity?.map((r) => (
                    <div key={r.id} className="mb-1.5 rounded border border-gray-200 bg-white p-2">
                      <div className="flex justify-between">
                        <b>{ACTION_LABEL[r.action] ?? r.action}</b>
                        <span className="text-gray-400">{fmtDate(r.ts)}</span>
                      </div>
                      <div className="text-gray-500">
                        {r.user_name} ({r.employee_id})
                      </div>
                      {r.reason && <div className="mt-0.5 text-gray-700">Reason: {r.reason}</div>}
                      {Array.isArray(r.details?.changes) && (
                        <ul className="mt-1 space-y-0.5">
                          {(r.details!.changes as { cell: string; old: unknown; new: unknown }[]).slice(0, 8).map((c) => (
                            <li key={c.cell} className="font-mono text-[10px]">
                              {c.cell}: {String(c.old ?? "∅")} → {String(c.new ?? "∅")}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {dialog === "save" && (
        <ReasonDialog
          title="Save new version"
          confirmLabel="Save version"
          reasonLabel="Reason for change"
          message={
            <div>
              <p className="mb-2">
                {pending.size} input cell{pending.size > 1 ? "s" : ""} changed. A new version (v{f.current_version + 1}) is created; earlier versions are kept.
              </p>
              <ul className="max-h-32 overflow-auto rounded border border-gray-200 bg-white p-2 font-mono text-[11px]">
                {[...pending.entries()].map(([k, v]) => (
                  <li key={k}>
                    {k} = {v === "" ? "(blank)" : v}
                  </li>
                ))}
              </ul>
            </div>
          }
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const edits = [...pending.entries()].map(([k, value]) => {
              const i = k.lastIndexOf("!");
              return { sheet: k.slice(0, i), cell: k.slice(i + 1), value };
            });
            const r = await api<{ version: number; changes: number }>(`/api/files/${id}/save`, { body: { baseVersion: f.current_version, reason, edits } });
            toast(`Saved version ${r.version} (${r.changes} cell change${r.changes === 1 ? "" : "s"})`);
            await load();
          }}
        />
      )}
      {dialog === "submit" && (
        <SubmitDialog
          fileId={id}
          resubmit={f.status === "CHANGES_REQUESTED"}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            toast("Submitted for review");
            load();
            refreshBadges();
          }}
        />
      )}
      {(dialog === "approve" || dialog === "reject") && (
        <ReasonDialog
          title={dialog === "approve" ? "Approve workbook" : "Request changes"}
          confirmLabel={dialog === "approve" ? "Sign & approve" : "Sign & send back"}
          danger={dialog === "reject"}
          requireSignature
          reasonRequired={dialog === "reject"}
          reasonLabel={dialog === "approve" ? "Approval comments" : "Summary for the author"}
          message={
            dialog === "approve"
              ? `Approving v${f.current_version} locks the workbook as approved.${addressedAnns ? ` ${addressedAnns} addressed annotation(s) will be closed.` : ""}${openAnns ? ` ${openAnns} annotation(s) are still open — close or delete them first.` : ""}`
              : `The workbook goes back to ${f.owner_name} with ${openAnns} open annotation(s).`
          }
          onClose={() => setDialog(null)}
          onConfirm={async (comment, password) => {
            await api(`/api/files/${id}/decision`, { body: { decision: dialog === "approve" ? "APPROVED" : "CHANGES_REQUESTED", comment, password } });
            toast(dialog === "approve" ? "Workbook approved" : "Changes requested");
            await load();
            refreshBadges();
          }}
        />
      )}
      {dialog === "withdraw" && (
        <ReasonDialog
          title="Withdraw from review"
          confirmLabel="Withdraw"
          reasonLabel="Reason for withdrawal"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(`/api/files/${id}/withdraw`, { body: { reason } });
            toast("Review withdrawn");
            await load();
          }}
        />
      )}
      {dialog === "revise" && (
        <ReasonDialog
          title="Start a new revision"
          confirmLabel="Start revision"
          reasonLabel="Reason for revision"
          message="The approved version stays in the history. The workbook returns to Draft so input cells can be edited and re-approved."
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(`/api/files/${id}/revise`, { body: { reason } });
            toast("Revision started");
            await load();
          }}
        />
      )}
    </div>
  );
}
