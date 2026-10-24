"use client";

import { Lock, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ExcelIcon, FolderIcon } from "../icons";
import { SecurityPanel } from "../SecurityPanel";
import { Button, ErrorText, Field, inputCls, Modal, StatusBadge } from "../ui";
import { api, cx, fmtBytes, fmtDate } from "@/lib/client";
import { PERM_KEYS, PERMS, type Perm } from "@/lib/constants";

export function NameDialog({
  title,
  label,
  initial,
  confirmLabel,
  onSubmit,
  onClose,
  icon,
}: {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  icon?: React.ReactNode;
}) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      icon={icon}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label}>
        <input
          className={inputCls}
          value={name}
          autoFocus
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
        />
      </Field>
      <ErrorText>{err}</ErrorText>
    </Modal>
  );
}

interface Template {
  id: number;
  name: string;
  version: number;
  path: string;
  updated_at: string;
}

export function TemplatePicker({ folderId, onCreated, onClose }: { folderId: number; onCreated: (id: number) => void; onClose: () => void }) {
  const [list, setList] = useState<Template[] | null>(null);
  const [sel, setSel] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ templates: Template[] }>("/api/templates").then((r) => setList(r.templates)).catch((e) => setErr(e.message));
  }, []);
  const create = async () => {
    if (!sel) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ id: number }>(`/api/files/${sel.id}/copy`, { body: { folderId, name: name.trim() || sel.name } });
      onCreated(r.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const shown = (list ?? []).filter((t) => (t.name + t.path).toLowerCase().includes(filter.toLowerCase()));
  return (
    <Modal
      title="New Excel sheet from template"
      icon={<ExcelIcon size={16} />}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!sel || busy} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <p className="mb-3 text-gray-600">Choose an approved workbook. A new draft copy is created in this folder and you become its author.</p>
      <input className={inputCls} placeholder="Search templates" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="mt-2 h-56 overflow-auto rounded border border-gray-300 bg-white">
        {!list && <div className="p-4 text-gray-400">Loading…</div>}
        {list && !shown.length && <div className="p-4 text-gray-400">No approved templates you can access.</div>}
        {shown.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setSel(t);
              setName(t.name.replace(/\.xlsx$/i, "") + " - " + new Date().toISOString().slice(0, 10) + ".xlsx");
            }}
            className={cx("flex w-full items-center gap-2 px-3 py-2 text-left", sel?.id === t.id ? "bg-[#cce8ff]" : "hover:bg-[#f0f6fc]")}
          >
            <ExcelIcon size={18} />
            <span className="flex-1 truncate">{t.name}</span>
            <span className="text-[11px] text-gray-500">
              {t.path} · v{t.version}
            </span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="mt-3">
          <Field label="New file name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
      )}
      <ErrorText>{err}</ErrorText>
    </Modal>
  );
}

export function AccessDenied({ folder, onClose }: { folder: { id: number; name: string }; onClose: () => void }) {
  const [mode, setMode] = useState<"info" | "request" | "sent">("info");
  const [perms, setPerms] = useState<Perm[]>(["read"]);
  const [why, setWhy] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setErr("");
    setBusy(true);
    try {
      await api("/api/access-requests", { body: { resourceType: "folder", resourceId: folder.id, perms, justification: why } });
      setMode("sent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={folder.name} icon={<FolderIcon size={16} locked />} onClose={onClose} width={460}>
      {mode === "info" && (
        <div className="flex gap-4">
          <ShieldAlert className="shrink-0 text-amber-500" size={36} />
          <div>
            <p className="mb-2 font-semibold">You don&apos;t currently have permission to access this folder.</p>
            <p className="mb-4 text-gray-600">Ask the folder owner or your administrator for access. Your request is recorded in the audit trail.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setMode("request")}>
                <Lock size={14} /> Request access
              </Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        </div>
      )}
      {mode === "request" && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-gray-700">Access needed</div>
            <div className="grid grid-cols-2 gap-1">
              {PERM_KEYS.filter((p) => p !== "manage").map((p) => (
                <label key={p} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    className="accent-brand-700"
                    checked={perms.includes(p)}
                    disabled={p === "read"}
                    onChange={() => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}
                  />
                  {PERMS[p].label}
                </label>
              ))}
            </div>
          </div>
          <Field label="Business justification" required>
            <textarea className={inputCls} rows={3} value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
          <ErrorText>{err}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || why.trim().length < 5} onClick={send}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </div>
        </div>
      )}
      {mode === "sent" && (
        <div>
          <p className="mb-4">Your request has been sent to the administrators. You&apos;ll see its status under My Tasks.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              OK
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface FolderInfo {
  name: string;
  location: string;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  folders: number;
  files: number;
  size: number;
}

export interface FileItem {
  id: number;
  name: string;
  status: string;
  current_version: number;
  size_bytes: number;
  updated_at: string;
  created_at: string;
  owner: string;
  reviewer: string | null;
  open_annotations: number;
  perms: Perm[];
  locked: boolean;
}

export function PropertiesDialog({
  target,
  path,
  onClose,
  onChanged,
}: {
  target: { type: "folder"; id: number; name: string } | { type: "file"; item: FileItem };
  path: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"general" | "security">("general");
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const isFolder = target.type === "folder";
  const name = isFolder ? target.name : target.item.name;
  const id = isFolder ? target.id : target.item.id;
  useEffect(() => {
    if (isFolder) api<FolderInfo>(`/api/folders/${id}`).then(setInfo).catch(() => {});
  }, [isFolder, id]);

  const rows: [string, React.ReactNode][] = isFolder
    ? info
      ? [
          ["Type:", "File folder"],
          ["Location:", info.location],
          ["Contains:", `${info.files} files, ${info.folders} folders`],
          ["Size:", fmtBytes(info.size)],
          ["Created:", fmtDate(info.created_at)],
          ["Created by:", info.created_by_name],
          ["Modified:", fmtDate(info.updated_at)],
        ]
      : []
    : [
        ["Type:", "Microsoft Excel Worksheet (.xlsx)"],
        ["Location:", path],
        ["Size:", fmtBytes(target.item.size_bytes)],
        ["Status:", <StatusBadge key="s" status={target.item.status} />],
        ["Version:", `v${target.item.current_version}`],
        ["Author:", target.item.owner],
        ["Created:", fmtDate(target.item.created_at)],
        ["Modified:", fmtDate(target.item.updated_at)],
        ["Open annotations:", String(target.item.open_annotations)],
      ];

  return (
    <Modal title={`${name} Properties`} icon={isFolder ? <FolderIcon size={16} /> : <ExcelIcon size={16} />} onClose={onClose} width={520} footer={<Button variant="primary" onClick={onClose}>OK</Button>}>
      <div className="-mx-5 -mt-5 mb-4 flex gap-1 border-b border-gray-200 bg-white px-4 pt-2">
        {(["general", "security"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-t px-3 py-1.5 text-[12px] capitalize", tab === t ? "border border-b-0 border-gray-300 bg-[#f9f9f9] font-semibold" : "text-gray-600 hover:bg-gray-100")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "general" && (
        <div>
          <div className="mb-4 flex items-center gap-3 border-b border-gray-200 pb-4">
            {isFolder ? <FolderIcon size={36} /> : <ExcelIcon size={36} />}
            <input className={inputCls} value={name} readOnly />
          </div>
          <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-600">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {tab === "security" && <SecurityPanel type={target.type} id={id} objectName={`${path}${path ? " \\ " : ""}${isFolder ? "" : name}`.replace(/ \\ $/, "")} onSaved={onChanged} />}
    </Modal>
  );
}
