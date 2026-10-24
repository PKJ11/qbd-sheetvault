"use client";

import { Building2, Globe2, ShieldCheck, User, UserCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, ErrorText, Field, inputCls, useToast } from "./ui";
import { api, cx } from "@/lib/client";
import { PERM_KEYS, PERMS, ROLE_KEYS, ROLES, type Perm, type PrincipalType } from "@/lib/constants";

interface AceView {
  principal_type: PrincipalType;
  principal_value: string;
  perms: Perm[];
  label: string;
  from?: string;
}
interface SecurityData {
  inherit: boolean;
  canManage: boolean;
  myPerms: Perm[];
  explicit: AceView[];
  inherited: AceView[];
}
interface DirUser {
  id: number;
  employee_id: string;
  full_name: string;
  department: string | null;
}

const keyOf = (a: { principal_type: string; principal_value: string }) => `${a.principal_type}:${a.principal_value}`;

function PrincipalIcon({ type }: { type: PrincipalType }) {
  const cls = "shrink-0 text-gray-600";
  if (type === "user") return <User size={15} className={cls} />;
  if (type === "role") return <UserCog size={15} className={cls} />;
  if (type === "department") return <Building2 size={15} className={cls} />;
  return <Globe2 size={15} className={cls} />;
}

export function SecurityPanel({ type, id, objectName, onSaved }: { type: "folder" | "file"; id: number; objectName: string; onSaved?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<SecurityData | null>(null);
  const [aces, setAces] = useState<AceView[]>([]);
  const [inherit, setInherit] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState<{ users: DirUser[]; departments: string[] }>({ users: [], departments: [] });

  const load = () =>
    api<SecurityData>(`/api/${type}s/${id}/security`)
      .then((d) => {
        setData(d);
        setAces(d.explicit.map((a) => ({ ...a })));
        setInherit(d.inherit);
        setSelected((s) => s ?? (d.explicit[0] ? keyOf(d.explicit[0]) : d.inherited[0] ? "i:" + keyOf(d.inherited[0]) : null));
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);
  useEffect(() => {
    if (data?.canManage) api<typeof dir>("/api/users/directory").then(setDir).catch(() => {});
  }, [data?.canManage]);

  const rows = useMemo(() => {
    const out: (AceView & { k: string; inheritedRow: boolean })[] = aces.map((a) => ({ ...a, k: keyOf(a), inheritedRow: false }));
    if (inherit) for (const a of data?.inherited ?? []) out.push({ ...a, k: "i:" + keyOf(a) + ":" + a.from, inheritedRow: true });
    return out;
  }, [aces, data, inherit]);
  const current = rows.find((r) => r.k === selected) ?? null;
  const dirty =
    !!data &&
    (inherit !== data.inherit ||
      JSON.stringify(aces.map((a) => [keyOf(a), [...a.perms].sort()]).sort()) !== JSON.stringify(data.explicit.map((a) => [keyOf(a), [...a.perms].sort()]).sort()));

  const toggle = (p: Perm) => {
    if (!current || current.inheritedRow || !data?.canManage) return;
    setAces((list) =>
      list.map((a) => {
        if (keyOf(a) !== current.k) return a;
        let perms = a.perms.includes(p) ? a.perms.filter((x) => x !== p) : [...a.perms, p];
        if (p === "manage" && !a.perms.includes("manage")) perms = [...PERM_KEYS];
        if (p !== "read" && !a.perms.includes(p) && !perms.includes("read")) perms.push("read");
        if (p !== "manage" && a.perms.includes(p)) perms = perms.filter((x) => x !== "manage");
        if (p === "read" && a.perms.includes("read")) perms = [];
        return { ...a, perms };
      }),
    );
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/${type}s/${id}/security`, {
        method: "PUT",
        body: { inherit, aces: aces.map((a) => ({ principal_type: a.principal_type, principal_value: a.principal_value, perms: a.perms })), reason },
      });
      toast("Permissions updated");
      setReason("");
      await load();
      onSaved?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="py-8 text-center text-gray-400">{err || "Loading…"}</div>;
  const effective = current?.perms ?? [];

  return (
    <div className="space-y-3">
      <div className="text-[12px] text-gray-600">
        Object name: <span className="font-medium text-gray-900">{objectName}</span>
      </div>
      <div>
        <div className="mb-1 text-[12px]">Group or user names:</div>
        <div className="h-36 overflow-auto rounded border border-gray-300 bg-white">
          {rows.length === 0 && <div className="p-3 text-xs text-gray-400">No entries. Only administrators{type === "file" ? " and the file owner" : ""} can access this {type}.</div>}
          {rows.map((r) => (
            <button
              key={r.k}
              onClick={() => setSelected(r.k)}
              className={cx("flex w-full items-center gap-2 px-2 py-1 text-left text-[12px]", selected === r.k ? "bg-[#cce8ff]" : "hover:bg-[#f0f6fc]")}
            >
              <PrincipalIcon type={r.principal_type} />
              <span className="flex-1 truncate">{r.label}</span>
              {r.inheritedRow && <span className="text-[10px] text-gray-500">inherited from {r.from}</span>}
            </button>
          ))}
        </div>
        {data.canManage && (
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" onClick={() => setAdding(true)}>
              Add…
            </Button>
            <Button size="sm" disabled={!current || current.inheritedRow} onClick={() => current && setAces((l) => l.filter((a) => keyOf(a) !== current.k))}>
              Remove
            </Button>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[12px]">Permissions for {current?.label ?? "—"}:</div>
        <table className="w-full rounded border border-gray-300 bg-white text-[12px]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              <th className="px-2 py-1 font-normal">Permission</th>
              <th className="w-16 px-2 py-1 text-center font-normal">Allow</th>
            </tr>
          </thead>
          <tbody>
            {PERM_KEYS.map((p) => (
              <tr key={p} title={PERMS[p].help}>
                <td className="px-2 py-0.5">
                  {PERMS[p].label}
                  <span className="ml-2 text-[10px] text-gray-400">{PERMS[p].help}</span>
                </td>
                <td className="px-2 py-0.5 text-center">
                  <input type="checkbox" className="accent-brand-700" checked={effective.includes(p) || effective.includes("manage")} disabled={!current || current.inheritedRow || !data.canManage} onChange={() => toggle(p)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" className="accent-brand-700" checked={inherit} disabled={!data.canManage} onChange={(e) => setInherit(e.target.checked)} />
        Include inheritable permissions from this object&apos;s parent
      </label>

      <div className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-600">
        <ShieldCheck size={14} className="text-brand-700" />
        Your effective access: {data.myPerms.length ? data.myPerms.map((p) => PERMS[p].label).join(", ") : "none"}
      </div>

      {data.canManage && dirty && (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
          <Field label="Reason for permission change" required>
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Access for new QC analyst per CR-0123" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={load}>
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={busy || reason.trim().length < 3} onClick={save}>
              Apply
            </Button>
          </div>
        </div>
      )}
      <ErrorText>{err}</ErrorText>

      {adding && (
        <AddPrincipal
          dir={dir}
          existing={aces.map(keyOf)}
          onClose={() => setAdding(false)}
          onAdd={(a) => {
            setAces((l) => [...l, a]);
            setSelected(keyOf(a));
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddPrincipal({ dir, existing, onAdd, onClose }: { dir: { users: DirUser[]; departments: string[] }; existing: string[]; onAdd: (a: AceView) => void; onClose: () => void }) {
  const [type, setType] = useState<PrincipalType>("user");
  const [value, setValue] = useState("");
  const [filter, setFilter] = useState("");
  const users = dir.users.filter((u) => `${u.full_name} ${u.employee_id} ${u.department ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const label = () => {
    if (type === "everyone") return "Everyone";
    if (type === "role") return `Role: ${ROLES[value as keyof typeof ROLES]}`;
    if (type === "department") return `Department: ${value}`;
    const u = dir.users.find((x) => String(x.id) === value);
    return u ? `${u.full_name} (${u.employee_id})` : value;
  };
  const v = type === "everyone" ? "" : value;
  const dup = existing.includes(`${type}:${v}`);
  return (
    <div className="rounded border border-gray-300 bg-white p-3">
      <div className="mb-2 text-[12px] font-semibold">Select users, roles or departments</div>
      <div className="mb-2 flex gap-1">
        {(["user", "role", "department", "everyone"] as PrincipalType[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setType(t);
              setValue("");
            }}
            className={cx("rounded px-2 py-1 text-[12px] capitalize", type === t ? "bg-brand-700 text-white" : "bg-gray-100 hover:bg-gray-200")}
          >
            {t}
          </button>
        ))}
      </div>
      {type === "user" && (
        <>
          <input className={inputCls} placeholder="Search name or Employee ID" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="mt-1 max-h-32 overflow-auto rounded border border-gray-200">
            {users.map((u) => (
              <button key={u.id} onClick={() => setValue(String(u.id))} className={cx("block w-full px-2 py-1 text-left text-[12px]", value === String(u.id) ? "bg-[#cce8ff]" : "hover:bg-gray-50")}>
                {u.full_name} <span className="text-gray-500">({u.employee_id}{u.department ? ` · ${u.department}` : ""})</span>
              </button>
            ))}
          </div>
        </>
      )}
      {type === "role" && (
        <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Select a role…</option>
          {ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {ROLES[r]}
            </option>
          ))}
        </select>
      )}
      {type === "department" && (
        <>
          <input className={inputCls} list="sv-departments" placeholder="Department name" value={value} onChange={(e) => setValue(e.target.value)} />
          <datalist id="sv-departments">
            {dir.departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </>
      )}
      {type === "everyone" && <p className="text-[12px] text-gray-600">All signed-in users.</p>}
      {dup && <p className="mt-2 text-[11px] text-amber-700">This entry already exists — select it in the list to change its permissions.</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={(type !== "everyone" && !value.trim()) || dup} onClick={() => onAdd({ principal_type: type, principal_value: v.trim(), perms: ["read"], label: label() })}>
          OK
        </Button>
      </div>
    </div>
  );
}
