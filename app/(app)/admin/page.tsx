"use client";

import { KeyRound, Lock, Pencil, Power, RotateCcw, Search, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { UserForm, type AdminUser } from "@/components/admin/UserForm";
import { ExcelIcon, FolderIcon } from "@/components/icons";
import { Button, Card, Empty, inputCls, ReasonDialog, useToast } from "@/components/ui";
import { api, cx, fmtDate } from "@/lib/client";
import { PERMS, ROLES, TEMP_PASSWORD, type Perm, type Role } from "@/lib/constants";

type Tab = "users" | "requests" | "bin";

function UsersTab() {
  const toast = useToast();
  const { user: me } = useMe();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<AdminUser | null | "new">(null);
  const [action, setAction] = useState<{ u: AdminUser; a: "reset_password" | "unlock" | "deactivate" | "activate" } | null>(null);
  const load = useCallback(() => api<{ users: AdminUser[] }>("/api/users").then((r) => setUsers(r.users)).catch((e) => toast(e.message, "err")), [toast]);
  useEffect(() => {
    load();
  }, [load]);
  const shown = (users ?? []).filter((u) => `${u.employee_id} ${u.full_name} ${u.email} ${u.department} ${u.designation}`.toLowerCase().includes(q.toLowerCase()));
  const titles = { reset_password: "Reset password", unlock: "Unlock account", deactivate: "Deactivate user", activate: "Re-activate user" };

  return (
    <Card
      title={`${users?.length ?? "…"} users`}
      actions={
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input className={`${inputCls} h-8 w-56 py-1 pl-8 text-xs`} placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button size="sm" variant="primary" onClick={() => setForm("new")}>
            <UserPlus size={14} /> Add user
          </Button>
        </>
      }
    >
      {!users ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                {["Employee", "Designation", "Department / Unit / Section", "Roles", "Reporting manager", "Joined", "Status", "Last sign-in", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={cx("border-t border-gray-100", !u.is_active && "bg-gray-50 text-gray-400")}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-900">{u.full_name}</div>
                    <div className="text-gray-500">
                      {u.employee_id} · {u.email}
                    </div>
                  </td>
                  <td className="px-3 py-2">{u.designation}</td>
                  <td className="px-3 py-2">{[u.department, u.unit, u.section].filter(Boolean).join(" / ")}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span key={r} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-800">
                          {ROLES[r as Role] ?? r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">{u.reporting_manager_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(u.joining_date, false)}</td>
                  <td className="px-3 py-2">
                    {!u.is_active ? (
                      <span className="font-semibold text-gray-500">Inactive</span>
                    ) : u.locked_at ? (
                      <span className="font-semibold text-red-600">Locked</span>
                    ) : u.must_change_password ? (
                      <span className="font-semibold text-amber-700">Temp. password</span>
                    ) : (
                      <span className="font-semibold text-green-700">Active</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{u.last_login_at ? fmtDate(u.last_login_at) : "Never"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="win-icon-btn h-7 w-7" title="Edit" onClick={() => setForm(u)}>
                        <Pencil size={14} />
                      </button>
                      <button className="win-icon-btn h-7 w-7" title={`Reset password to ${TEMP_PASSWORD}`} onClick={() => setAction({ u, a: "reset_password" })}>
                        <KeyRound size={14} />
                      </button>
                      {u.locked_at && (
                        <button className="win-icon-btn h-7 w-7 text-red-600" title="Unlock" onClick={() => setAction({ u, a: "unlock" })}>
                          <Lock size={14} />
                        </button>
                      )}
                      {u.id !== me.id && (
                        <button className={cx("win-icon-btn h-7 w-7", u.is_active ? "text-red-600" : "text-green-700")} title={u.is_active ? "Deactivate" : "Activate"} onClick={() => setAction({ u, a: u.is_active ? "deactivate" : "activate" })}>
                          <Power size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <UserForm
          user={form === "new" ? null : form}
          users={users ?? []}
          onClose={() => setForm(null)}
          onSaved={(m) => {
            setForm(null);
            toast(m);
            load();
          }}
        />
      )}
      {action && (
        <ReasonDialog
          title={`${titles[action.a]} — ${action.u.full_name}`}
          confirmLabel={titles[action.a]}
          danger={action.a === "deactivate"}
          message={
            action.a === "reset_password"
              ? `The password is reset to the temporary password ${TEMP_PASSWORD}. ${action.u.full_name} must change it at next sign-in and is signed out everywhere.`
              : action.a === "deactivate"
                ? "The user can no longer sign in. Their records and history are kept."
                : undefined
          }
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await api(`/api/users/${action.u.id}`, { method: "PATCH", body: { action: action.a, reason } });
            toast(`${titles[action.a]}: done`);
            load();
          }}
        />
      )}
    </Card>
  );
}

interface AccessReq {
  id: number;
  path: string;
  requested_by_name: string;
  requested_by_employee_id: string;
  department: string | null;
  requested_perms: Perm[];
  justification: string;
  status: string;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

function RequestsTab() {
  const toast = useToast();
  const { refreshBadges } = useMe();
  const [status, setStatus] = useState("PENDING");
  const [list, setList] = useState<AccessReq[] | null>(null);
  const [decide, setDecide] = useState<{ r: AccessReq; d: "APPROVED" | "REJECTED" } | null>(null);
  const load = useCallback(() => api<{ requests: AccessReq[] }>(`/api/access-requests?status=${status}`).then((r) => setList(r.requests)), [status]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Card
      title="Folder access requests"
      actions={
        <select className={`${inputCls} h-8 w-36 py-1 text-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
          {["PENDING", "APPROVED", "REJECTED", "ALL"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      }
    >
      {!list ? (
        <Empty>Loading…</Empty>
      ) : list.length === 0 ? (
        <Empty>No requests.</Empty>
      ) : (
        list.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start gap-3 border-b border-gray-100 px-5 py-3 text-sm last:border-0">
            <FolderIcon size={22} locked={r.status === "PENDING"} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900">{r.path}</div>
              <div className="text-xs text-gray-600">
                {r.requested_by_name} ({r.requested_by_employee_id}
                {r.department ? ` · ${r.department}` : ""}) requests <b>{r.requested_perms.map((p) => PERMS[p]?.label ?? p).join(", ")}</b> · {fmtDate(r.created_at)}
              </div>
              <div className="mt-1 text-xs italic text-gray-700">“{r.justification}”</div>
              {r.decided_by_name && (
                <div className="mt-1 text-xs text-gray-500">
                  {r.status} by {r.decided_by_name} · {fmtDate(r.decided_at)}
                  {r.decision_note ? ` — ${r.decision_note}` : ""}
                </div>
              )}
            </div>
            {r.status === "PENDING" && (
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={() => setDecide({ r, d: "REJECTED" })}>
                  Reject
                </Button>
                <Button size="sm" variant="primary" onClick={() => setDecide({ r, d: "APPROVED" })}>
                  Approve
                </Button>
              </div>
            )}
          </div>
        ))
      )}
      {decide && (
        <ReasonDialog
          title={`${decide.d === "APPROVED" ? "Grant" : "Reject"} access — ${decide.r.path}`}
          confirmLabel={decide.d === "APPROVED" ? "Grant access" : "Reject"}
          danger={decide.d === "REJECTED"}
          reasonLabel="Note"
          reasonRequired={decide.d === "REJECTED"}
          message={decide.d === "APPROVED" ? `${decide.r.requested_by_name} will be added to the folder's permissions with: ${decide.r.requested_perms.join(", ")}.` : undefined}
          onClose={() => setDecide(null)}
          onConfirm={async (note) => {
            await api(`/api/access-requests/${decide.r.id}`, { method: "PATCH", body: { decision: decide.d, note } });
            toast(decide.d === "APPROVED" ? "Access granted" : "Request rejected");
            load();
            refreshBadges();
          }}
        />
      )}
    </Card>
  );
}

interface BinItem {
  id: number;
  name: string;
  deleted_at: string;
  deleted_by_name: string | null;
  parent_name: string | null;
  status?: string;
  parent_deleted?: boolean;
}

function BinTab() {
  const toast = useToast();
  const [bin, setBin] = useState<{ folders: BinItem[]; files: BinItem[] } | null>(null);
  const [restore, setRestore] = useState<{ type: "folder" | "file"; item: BinItem } | null>(null);
  const load = useCallback(() => api<{ folders: BinItem[]; files: BinItem[] }>("/api/recycle-bin").then(setBin), []);
  useEffect(() => {
    load();
  }, [load]);
  const items = bin ? [...bin.folders.map((i) => ({ type: "folder" as const, i })), ...bin.files.filter((f) => !f.parent_deleted).map((i) => ({ type: "file" as const, i }))] : [];
  return (
    <Card title="Recycle Bin">
      {!bin ? (
        <Empty>Loading…</Empty>
      ) : items.length === 0 ? (
        <Empty>The Recycle Bin is empty.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              {["Name", "Original location", "Deleted", "Deleted by", ""].map((h) => (
                <th key={h} className="px-4 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(({ type, i }) => (
              <tr key={type + i.id} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {type === "folder" ? <FolderIcon size={18} /> : <ExcelIcon size={18} />} {i.name}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-gray-600">{i.parent_name ?? "SheetVault"}</td>
                <td className="px-4 py-2 text-xs">{fmtDate(i.deleted_at)}</td>
                <td className="px-4 py-2 text-xs">{i.deleted_by_name}</td>
                <td className="px-4 py-2 text-right">
                  <Button size="sm" onClick={() => setRestore({ type, item: i })}>
                    <RotateCcw size={13} /> Restore
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="flex items-center gap-1.5 border-t border-gray-100 px-5 py-2 text-[11px] text-gray-500">
        <Trash2 size={12} /> Items are never permanently destroyed, so GxP records stay retrievable.
      </p>
      {restore && (
        <ReasonDialog
          title={`Restore ${restore.item.name}`}
          confirmLabel="Restore"
          reasonLabel="Reason for restoring"
          onClose={() => setRestore(null)}
          onConfirm={async (reason) => {
            await api("/api/recycle-bin", { body: { type: restore.type, id: restore.item.id, reason } });
            toast("Restored");
            load();
          }}
        />
      )}
    </Card>
  );
}

function AdminInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { caps } = useMe();
  const tab = (params.get("tab") as Tab) || "users";
  if (!caps.admin) return <div className="p-10 text-center text-red-600">Administrator access required.</div>;
  const tabs: [Tab, string][] = [
    ["users", "Users"],
    ["requests", "Access requests"],
    ["bin", "Recycle Bin"],
  ];
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
          <Users size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
          <p className="text-sm text-gray-500">Manage users, approve folder access and restore deleted items. Folder permissions are set from File Explorer → Properties → Security.</p>
        </div>
      </div>
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => router.replace(`/admin?tab=${k}`)} className={cx("border-b-2 px-4 py-2 text-sm font-medium", tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-gray-500 hover:text-gray-800")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "requests" && <RequestsTab />}
      {tab === "bin" && <BinTab />}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminInner />
    </Suspense>
  );
}
