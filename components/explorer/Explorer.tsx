"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FolderPlus,
  Info,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../AppShell";
import { ExcelIcon, FolderIcon, PcIcon } from "../icons";
import { ReasonDialog, StatusBadge, useToast } from "../ui";
import { AccessDenied, NameDialog, PropertiesDialog, TemplatePicker, type FileItem } from "./dialogs";
import { api, ApiError, cx, fmtBytes, fmtDate } from "@/lib/client";
import type { Perm } from "@/lib/constants";

interface FolderItem {
  id: number;
  name: string;
  updated_at: string;
  created_at: string;
  owner: string | null;
  items: number;
  perms: Perm[];
  locked: boolean;
}
interface Listing {
  folder: { id: number | null; name: string; perms: Perm[] };
  path: { id: number; name: string }[];
  folders: FolderItem[];
  files: FileItem[];
}
interface TreeNode {
  id: number;
  parent_id: number | null;
  name: string;
  locked: boolean;
}
type Sel = { type: "folder"; id: number } | { type: "file"; id: number } | null;
type SortKey = "name" | "modified" | "type" | "status" | "size" | "owner";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function Explorer() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { caps } = useMe();
  const folderParam = params.get("folder");
  const folderId = folderParam ? Number(folderParam) : null;

  const [data, setData] = useState<Listing | null>(null);
  const [denied, setDenied] = useState<{ id: number; name: string; path: { id: number; name: string }[] } | null>(null);
  const [showDenied, setShowDenied] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState<"details" | "tiles">("details");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; target: Sel } | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [dialog, setDialog] = useState<null | "newFolder" | "rename" | "delete" | "properties" | "template" | "folderProps">(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setView(load("sv.view", "details"));
    setExpanded(new Set(load<number[]>("sv.expanded", [])));
  }, []);

  const refreshTree = useCallback(() => {
    api<{ nodes: TreeNode[] }>("/api/folders/tree").then((r) => setTree(r.nodes)).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<Listing>(`/api/explorer?folder=${folderId ?? "root"}`);
      setData(r);
      setDenied(null);
      if (r.path.length) {
        setExpanded((prev) => {
          const next = new Set(prev);
          r.path.slice(0, -1).forEach((p) => next.add(p.id));
          return next;
        });
      }
    } catch (e) {
      const err = e as ApiError;
      const d = err.data as { denied?: boolean; folder?: { id: number; name: string }; path?: { id: number; name: string }[] } | undefined;
      if (err.status === 403 && d?.denied && d.folder) {
        setDenied({ ...d.folder, path: d.path ?? [] });
        setData(null);
      } else {
        toast(err.message, "err");
      }
    } finally {
      setLoading(false);
    }
  }, [folderId, toast]);

  useEffect(() => {
    setSel(null);
    setFilter("");
    refresh();
  }, [refresh]);
  useEffect(() => refreshTree(), [refreshTree]);
  useEffect(() => save("sv.expanded", [...expanded]), [expanded]);

  const go = (id: number | null) => router.push(id === null ? "/explorer" : `/explorer?folder=${id}`);

  const items = useMemo(() => {
    if (!data) return [] as ({ kind: "folder"; f: FolderItem } | { kind: "file"; f: FileItem })[];
    const q = filter.toLowerCase();
    const folders = data.folders.filter((f) => f.name.toLowerCase().includes(q)).map((f) => ({ kind: "folder" as const, f }));
    const files = data.files.filter((f) => f.name.toLowerCase().includes(q)).map((f) => ({ kind: "file" as const, f }));
    const val = (x: (typeof folders)[number] | (typeof files)[number]) => {
      switch (sort.key) {
        case "name":
          return x.f.name.toLowerCase();
        case "modified":
          return x.f.updated_at;
        case "type":
          return x.kind;
        case "status":
          return x.kind === "file" ? x.f.status : "";
        case "size":
          return x.kind === "file" ? x.f.size_bytes : x.f.items;
        case "owner":
          return (x.f.owner ?? "").toLowerCase();
      }
    };
    const cmp = (a: (typeof folders)[number] | (typeof files)[number], b: (typeof folders)[number] | (typeof files)[number]) => {
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    };
    // Folders always first, like Windows.
    return [...folders.sort(cmp), ...files.sort(cmp)];
  }, [data, filter, sort]);

  const selFolder = sel?.type === "folder" ? data?.folders.find((f) => f.id === sel.id) : undefined;
  const selFile = sel?.type === "file" ? data?.files.find((f) => f.id === sel.id) : undefined;
  const selPerms: Perm[] = selFolder?.perms ?? selFile?.perms ?? [];
  const cur = data?.folder;
  const can = (p: Perm) => !!cur?.perms.includes(p);
  const atRoot = folderId === null;
  const pathText = data ? ["SheetVault", ...data.path.map((p) => p.name)].join(" \\ ") : "";

  const open = (s: Sel) => {
    if (!s) return;
    if (s.type === "folder") {
      const f = data?.folders.find((x) => x.id === s.id);
      if (f?.locked) return setShowDenied({ id: f.id, name: f.name });
      go(s.id);
    } else {
      const f = data?.files.find((x) => x.id === s.id);
      if (f?.locked) return toast(`Access denied. You don't have permission to open "${f.name}".`, "err");
      router.push(`/files/${s.id}`);
    }
  };

  const upload = async (files: FileList | File[]) => {
    if (!cur?.id) return;
    const list = [...files];
    for (const f of list) {
      if (!/\.xlsx$/i.test(f.name)) {
        toast(`"${f.name}" skipped — only .xlsx workbooks are allowed.`, "err");
        continue;
      }
      setUploading(f.name);
      const form = new FormData();
      form.set("folderId", String(cur.id));
      form.set("file", f);
      try {
        const r = await api<{ name: string }>("/api/files/upload", { form });
        toast(`Uploaded "${r.name}"`);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, "err");
      }
    }
    setUploading(null);
    refresh();
  };

  const download = (id: number) => {
    window.location.href = `/api/files/${id}/download`;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "Enter" && sel) open(sel);
    else if (e.key === "F2" && sel && selPerms.includes("edit")) setDialog("rename");
    else if (e.key === "Delete" && sel && selPerms.includes("delete")) setDialog("delete");
    else if (e.key === "Backspace" && data?.path.length) go(data.path.length > 1 ? data.path[data.path.length - 2].id : null);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = items.findIndex((x) => sel && x.kind === sel.type && x.f.id === sel.id);
      const next = items[Math.max(0, Math.min(items.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSel({ type: next.kind, id: next.f.id });
    }
  };

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th className={cx("sticky top-0 z-10 bg-white px-2 py-1.5 text-left text-[12px] font-normal text-gray-600 hover:bg-[#f0f6fc]", className)}>
      <button className="flex w-full items-center gap-1" onClick={() => sortBy(k)}>
        {label}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  const children = (pid: number | null) => tree.filter((n) => n.parent_id === pid);
  const TreeItem = ({ node, depth }: { node: TreeNode; depth: number }) => {
    const kids = children(node.id);
    const isOpen = expanded.has(node.id);
    const active = folderId === node.id;
    return (
      <>
        <div
          className={cx("flex h-7 cursor-default items-center gap-1 rounded pr-2 text-[13px]", active ? "bg-[#cce8ff]" : "hover:bg-[#e9e9e9]")}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => (node.locked ? setShowDenied({ id: node.id, name: node.name }) : go(node.id))}
        >
          <button
            className="flex h-5 w-4 items-center justify-center text-gray-500"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((s) => {
                const n = new Set(s);
                if (n.has(node.id)) n.delete(node.id);
                else n.add(node.id);
                return n;
              });
            }}
          >
            {kids.length > 0 && !node.locked ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
          </button>
          <FolderIcon size={16} locked={node.locked} open={active} />
          <span className="truncate">{node.name}</span>
        </div>
        {isOpen && !node.locked && kids.map((k) => <TreeItem key={k.id} node={k} depth={depth + 1} />)}
      </>
    );
  };

  const ctx = (e: React.MouseEvent, target: Sel) => {
    e.preventDefault();
    e.stopPropagation();
    if (target) setSel(target);
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 320), target });
  };

  const MenuItem = ({ icon: Icon, label, onClick, disabled, hint }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void; disabled?: boolean; hint?: string }) => (
    <button
      className="win-menu-item"
      disabled={disabled}
      onClick={() => {
        setMenu(null);
        onClick();
      }}
    >
      <Icon size={15} />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </button>
  );

  const crumbs = denied ? denied.path : data?.path ?? [];

  return (
    <div className="win flex flex-1 flex-col p-3 md:p-4" onClick={() => (setMenu(null), setNewMenu(false))}>
      <div className="flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-lg border border-[#d6d6d6] bg-[var(--win-bg)] shadow-md">
        {/* Title bar */}
        <div className="flex h-9 items-center gap-2 border-b border-[#e5e5e5] bg-[#eeeeee] px-3 text-[12px]">
          <FolderIcon size={16} open />
          <span className="truncate">{denied?.name ?? cur?.name ?? "SheetVault"}</span>
          <span className="ml-auto text-gray-500">File Explorer</span>
        </div>

        {/* Address bar */}
        <div className="flex items-center gap-1 border-b border-[#e5e5e5] bg-[#f9f9f9] px-2 py-1.5">
          <button className="win-icon-btn" title="Back (Alt+Left)" onClick={() => router.back()}>
            <ArrowLeft size={16} />
          </button>
          <button className="win-icon-btn" title="Forward" onClick={() => router.forward()}>
            <ArrowRight size={16} />
          </button>
          <button className="win-icon-btn" title="Up to parent folder" disabled={atRoot} onClick={() => go(crumbs.length > 1 ? crumbs[crumbs.length - 2].id : null)}>
            <ArrowUp size={16} />
          </button>
          <button className="win-icon-btn" title="Refresh" onClick={() => (refresh(), refreshTree())}>
            <RotateCw size={15} />
          </button>
          <div className="mx-1 flex h-8 min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded border border-[#d6d6d6] bg-white px-2">
            <PcIcon size={16} />
            <ChevronRight size={13} className="shrink-0 text-gray-400" />
            <button className="shrink-0 rounded px-1.5 py-0.5 hover:bg-[#e5f3ff]" onClick={() => go(null)}>
              SheetVault
            </button>
            {crumbs.map((p) => (
              <span key={p.id} className="flex min-w-0 items-center">
                <ChevronRight size={13} className="shrink-0 text-gray-400" />
                <button className="truncate rounded px-1.5 py-0.5 hover:bg-[#e5f3ff]" onClick={() => go(p.id)}>
                  {p.name}
                </button>
              </span>
            ))}
          </div>
          <div className="flex h-8 w-56 items-center gap-2 rounded border border-[#d6d6d6] bg-white px-2 max-md:hidden">
            <input className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" placeholder={`Search ${cur?.name ?? "SheetVault"}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Search size={14} className="text-gray-500" />
          </div>
        </div>

        {/* Command bar */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-[#e5e5e5] bg-[#f9f9f9] px-2 py-1">
          <div className="relative">
            <button
              className="win-btn"
              disabled={!can("create") && !can("upload")}
              onClick={(e) => {
                e.stopPropagation();
                setNewMenu((m) => !m);
              }}
            >
              <Plus size={16} className="text-brand-700" /> New <ChevronDown size={12} />
            </button>
            {newMenu && (
              <div className="win-menu absolute left-0 top-9 z-30" onClick={(e) => e.stopPropagation()}>
                <MenuItem icon={FolderPlus} label="Folder" disabled={!can("create")} onClick={() => (setNewMenu(false), setDialog("newFolder"))} />
                <MenuItem icon={FilePlus2} label="Excel sheet from template…" disabled={atRoot || !can("create")} onClick={() => (setNewMenu(false), setDialog("template"))} />
                <MenuItem icon={Upload} label="Upload Excel files…" disabled={atRoot || !can("upload")} onClick={() => (setNewMenu(false), fileInput.current?.click())} />
              </div>
            )}
          </div>
          <span className="mx-1 h-5 w-px bg-gray-300" />
          <button className="win-btn" disabled={atRoot || !can("upload")} onClick={() => fileInput.current?.click()} title="Upload .xlsx files">
            <Upload size={15} /> <span className="max-sm:hidden">Upload</span>
          </button>
          <button className="win-icon-btn" title="Rename (F2)" disabled={!sel || !selPerms.includes("edit")} onClick={() => setDialog("rename")}>
            <Pencil size={15} />
          </button>
          <button className="win-icon-btn" title="Delete (Del)" disabled={!sel || !selPerms.includes("delete")} onClick={() => setDialog("delete")}>
            <Trash2 size={15} />
          </button>
          <button className="win-icon-btn" title="Download" disabled={!selFile || selFile.locked} onClick={() => selFile && download(selFile.id)}>
            <Download size={15} />
          </button>
          <span className="mx-1 h-5 w-px bg-gray-300" />
          <button className="win-btn" disabled={!sel && atRoot} onClick={() => setDialog(sel ? "properties" : "folderProps")} title="Properties & security">
            <Shield size={15} /> <span className="max-sm:hidden">Properties</span>
          </button>
          {selFolder?.locked && (
            <button className="win-btn text-amber-700" onClick={() => setShowDenied({ id: selFolder.id, name: selFolder.name })}>
              <Lock size={15} /> Request access
            </button>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <button className={cx("win-icon-btn", view === "details" && "bg-[#e5e5e5]")} title="Details" onClick={() => (setView("details"), save("sv.view", "details"))}>
              <List size={16} />
            </button>
            <button className={cx("win-icon-btn", view === "tiles" && "bg-[#e5e5e5]")} title="Large icons" onClick={() => (setView("tiles"), save("sv.view", "tiles"))}>
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Navigation pane */}
          <aside className="w-60 shrink-0 overflow-auto border-r border-[#e5e5e5] bg-[#f9f9f9] p-1.5 max-md:hidden">
            <div
              className={cx("flex h-7 cursor-default items-center gap-1.5 rounded px-2 text-[13px]", atRoot ? "bg-[#cce8ff]" : "hover:bg-[#e9e9e9]")}
              onClick={() => go(null)}
            >
              <PcIcon size={16} />
              <span className="font-medium">SheetVault</span>
            </div>
            {children(null).map((n) => (
              <TreeItem key={n.id} node={n} depth={1} />
            ))}
          </aside>

          {/* Content pane */}
          <div
            ref={pane}
            tabIndex={0}
            onKeyDown={onKey}
            className={cx("relative min-w-0 flex-1 overflow-auto bg-white outline-none", dragging && "ring-2 ring-inset ring-brand-500")}
            onClick={() => setSel(null)}
            onContextMenu={(e) => ctx(e, null)}
            onDragOver={(e) => {
              if (!can("upload") || atRoot) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (can("upload") && !atRoot) upload(e.dataTransfer.files);
            }}
          >
            {denied ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <FolderIcon size={56} locked />
                <div className="text-base font-semibold">You don&apos;t have permission to access this folder</div>
                <button className="win-btn border border-gray-300" onClick={() => setShowDenied({ id: denied.id, name: denied.name })}>
                  <Lock size={14} /> Request access
                </button>
              </div>
            ) : view === "details" ? (
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr className="border-b border-[#e5e5e5]">
                    <SortHead k="name" label="Name" className="w-[34%] pl-4" />
                    <SortHead k="modified" label="Date modified" />
                    <SortHead k="type" label="Type" />
                    <SortHead k="status" label="Status" />
                    <SortHead k="owner" label="Author" />
                    <SortHead k="size" label="Size" className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => {
                    const selected = !!sel && sel.type === x.kind && sel.id === x.f.id;
                    return (
                      <tr
                        key={x.kind + x.f.id}
                        className={cx("win-row cursor-default text-[13px]", selected && "selected", x.f.locked && "text-gray-500")}
                        onClick={(e) => (e.stopPropagation(), setSel({ type: x.kind, id: x.f.id }))}
                        onDoubleClick={() => open({ type: x.kind, id: x.f.id })}
                        onContextMenu={(e) => ctx(e, { type: x.kind, id: x.f.id })}
                      >
                        <td className="py-[5px] pl-4 pr-2">
                          <div className="flex items-center gap-2">
                            {x.kind === "folder" ? <FolderIcon size={18} locked={x.f.locked} /> : <ExcelIcon size={18} locked={x.f.locked} />}
                            <span className="truncate">{x.f.name}</span>
                            {x.kind === "file" && x.f.open_annotations > 0 && (
                              <span className="rounded bg-red-50 px-1 text-[10px] font-semibold text-red-700" title="Open annotations">
                                {x.f.open_annotations} note{x.f.open_annotations > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 text-gray-600">{fmtDate(x.f.updated_at)}</td>
                        <td className="whitespace-nowrap px-2 text-gray-600">{x.kind === "folder" ? "File folder" : `Excel Worksheet · v${x.f.current_version}`}</td>
                        <td className="px-2">{x.kind === "file" ? <StatusBadge status={x.f.status} /> : x.f.locked ? <span className="text-[11px] text-gray-500">No access</span> : null}</td>
                        <td className="truncate px-2 text-gray-600">{x.f.owner}</td>
                        <td className="whitespace-nowrap px-2 pr-4 text-right text-gray-600">{x.kind === "file" ? fmtBytes(x.f.size_bytes) : `${x.f.items} items`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1 p-3">
                {items.map((x) => {
                  const selected = !!sel && sel.type === x.kind && sel.id === x.f.id;
                  return (
                    <div
                      key={x.kind + x.f.id}
                      className={cx("win-row flex cursor-default flex-col items-center gap-1 rounded p-2 text-center text-[12px]", selected && "selected")}
                      onClick={(e) => (e.stopPropagation(), setSel({ type: x.kind, id: x.f.id }))}
                      onDoubleClick={() => open({ type: x.kind, id: x.f.id })}
                      onContextMenu={(e) => ctx(e, { type: x.kind, id: x.f.id })}
                    >
                      {x.kind === "folder" ? <FolderIcon size={56} locked={x.f.locked} /> : <ExcelIcon size={52} locked={x.f.locked} />}
                      <span className="line-clamp-2 break-all">{x.f.name}</span>
                      {x.kind === "file" && <StatusBadge status={x.f.status} />}
                    </div>
                  );
                })}
              </div>
            )}
            {!denied && loading && !data && (
              <div className="flex flex-col items-center gap-3 py-16 text-[13px] text-gray-500">
                <span className="h-7 w-7 animate-spin rounded-full border-4 border-brand-100 border-t-brand-700" />
                Loading…
              </div>
            )}
            {!denied && !loading && items.length === 0 && (
              <div className="py-16 text-center text-[13px] text-gray-400">
                {filter ? "No items match your search." : "This folder is empty."}
                {!atRoot && can("upload") && !filter && <div className="mt-1">Drag .xlsx files here or use Upload.</div>}
              </div>
            )}
            {loading && <div className="absolute right-3 top-2 text-[11px] text-gray-400">Loading…</div>}
            {dragging && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand-50/70 text-sm font-semibold text-brand-800">
                Drop .xlsx files to upload to “{cur?.name}”
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="flex h-7 items-center gap-4 border-t border-[#e5e5e5] bg-[#f3f3f3] px-3 text-[12px] text-gray-600">
          <span>{items.length} items</span>
          {sel && <span>1 item selected{selFile ? `  ${fmtBytes(selFile.size_bytes)}` : ""}</span>}
          {uploading && <span className="text-brand-700">Uploading {uploading}…</span>}
          <span className="ml-auto flex items-center gap-1">
            <Info size={12} />
            {cur?.perms.length ? `Your access: ${cur.perms.join(", ")}` : ""}
          </span>
        </div>
      </div>

      <input ref={fileInput} type="file" accept=".xlsx" multiple hidden onChange={(e) => (e.target.files && upload(e.target.files), (e.target.value = ""))} />

      {/* Context menu */}
      {menu && (
        <div className="win-menu fixed z-50" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.target ? (
            <>
              <MenuItem icon={menu.target.type === "folder" ? FolderPlus : FilePlus2} label="Open" hint="Enter" onClick={() => open(menu.target)} />
              {selFile && <MenuItem icon={Download} label="Download" disabled={selFile.locked} onClick={() => download(selFile.id)} />}
              {selFolder?.locked && <MenuItem icon={Lock} label="Request access…" onClick={() => setShowDenied({ id: selFolder.id, name: selFolder.name })} />}
              <div className="my-1 h-px bg-gray-200" />
              <MenuItem icon={Pencil} label="Rename" hint="F2" disabled={!selPerms.includes("edit")} onClick={() => setDialog("rename")} />
              <MenuItem icon={Trash2} label="Delete" hint="Del" disabled={!selPerms.includes("delete")} onClick={() => setDialog("delete")} />
              <div className="my-1 h-px bg-gray-200" />
              <MenuItem icon={Shield} label="Properties" onClick={() => setDialog("properties")} />
            </>
          ) : (
            <>
              <MenuItem icon={FolderPlus} label="New folder" disabled={!can("create")} onClick={() => setDialog("newFolder")} />
              <MenuItem icon={FilePlus2} label="New Excel sheet from template…" disabled={atRoot || !can("create")} onClick={() => setDialog("template")} />
              <MenuItem icon={Upload} label="Upload files…" disabled={atRoot || !can("upload")} onClick={() => fileInput.current?.click()} />
              <div className="my-1 h-px bg-gray-200" />
              <MenuItem icon={RotateCw} label="Refresh" onClick={() => (refresh(), refreshTree())} />
              <MenuItem icon={Shield} label="Properties" disabled={atRoot} onClick={() => setDialog("folderProps")} />
            </>
          )}
        </div>
      )}

      {dialog === "newFolder" && (
        <NameDialog
          title="New folder"
          label="Folder name"
          initial="New folder"
          confirmLabel="Create"
          icon={<FolderIcon size={16} />}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api("/api/folders", { body: { parentId: folderId, name } });
            toast(`Folder "${name}" created`);
            refresh();
            refreshTree();
          }}
        />
      )}
      {dialog === "rename" && sel && (
        <NameDialog
          title="Rename"
          label="New name"
          initial={selFolder?.name ?? selFile?.name ?? ""}
          confirmLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await api(`/api/${sel.type}s/${sel.id}`, { method: "PATCH", body: { name } });
            toast("Renamed");
            refresh();
            if (sel.type === "folder") refreshTree();
          }}
        />
      )}
      {dialog === "delete" && sel && (
        <ReasonDialog
          title={`Delete ${sel.type}`}
          danger
          confirmLabel="Delete"
          reasonLabel="Reason for deletion"
          message={
            <>
              Move <b>{selFolder?.name ?? selFile?.name}</b> to the Recycle Bin?
              {sel.type === "folder" && " Everything inside it is deleted too."} Records are retained and can be restored by an administrator.
            </>
          }
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(`/api/${sel.type}s/${sel.id}`, { method: "DELETE", body: { reason } });
            toast("Moved to Recycle Bin");
            setSel(null);
            refresh();
            if (sel.type === "folder") refreshTree();
          }}
        />
      )}
      {dialog === "properties" && sel && (selFolder || selFile) && (
        <PropertiesDialog
          target={selFolder ? { type: "folder", id: selFolder.id, name: selFolder.name } : { type: "file", item: selFile! }}
          path={pathText}
          onClose={() => setDialog(null)}
          onChanged={() => (refresh(), refreshTree())}
        />
      )}
      {dialog === "folderProps" && cur?.id && (
        <PropertiesDialog
          target={{ type: "folder", id: cur.id, name: cur.name }}
          path={data!.path.slice(0, -1).map((p) => p.name).join(" \\ ") || "SheetVault"}
          onClose={() => setDialog(null)}
          onChanged={() => (refresh(), refreshTree())}
        />
      )}
      {dialog === "template" && cur?.id && (
        <TemplatePicker folderId={cur.id} onClose={() => setDialog(null)} onCreated={(id) => router.push(`/files/${id}`)} />
      )}
      {showDenied && <AccessDenied folder={showDenied} onClose={() => setShowDenied(null)} />}
      {!caps.admin && atRoot && data && data.folders.length === 0 && (
        <p className="mt-3 text-center text-xs text-gray-500">No folders yet. Ask your administrator to set up folders and permissions.</p>
      )}
    </div>
  );
}
