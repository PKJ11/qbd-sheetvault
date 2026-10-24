"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { Button, ErrorText, Field, inputCls, Modal } from "../ui";
import { api, cx } from "@/lib/client";
import { ROLE_KEYS, ROLES, TEMP_PASSWORD } from "@/lib/constants";

export interface AdminUser {
  id: number;
  employee_id: string;
  full_name: string;
  email: string;
  designation: string | null;
  joining_date: string | null;
  roles: string[];
  department: string | null;
  unit: string | null;
  section: string | null;
  reporting_manager_id: number | null;
  reporting_manager_name: string | null;
  justification: string | null;
  must_change_password: boolean;
  is_active: boolean;
  locked_at: string | null;
  failed_attempts: number;
  last_login_at: string | null;
  created_at: string;
}

const EMPTY = {
  employee_id: "",
  full_name: "",
  email: "",
  designation: "",
  joining_date: "",
  roles: ["ANALYST"] as string[],
  department: "",
  unit: "",
  section: "",
  reporting_manager_id: null as number | null,
  justification: "",
};

export function UserForm({ user, users, onClose, onSaved }: { user: AdminUser | null; users: AdminUser[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState(() =>
    user
      ? {
          employee_id: user.employee_id,
          full_name: user.full_name,
          email: user.email,
          designation: user.designation ?? "",
          joining_date: user.joining_date ?? "",
          roles: user.roles,
          department: user.department ?? "",
          unit: user.unit ?? "",
          section: user.section ?? "",
          reporting_manager_id: user.reporting_manager_id,
          justification: user.justification ?? "",
        }
      : EMPTY,
  );
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const departments = [...new Set(users.map((u) => u.department).filter(Boolean))] as string[];
  const units = [...new Set(["Unit 1", "Unit 2", "Unit 3", "Unit 4", ...users.map((u) => u.unit).filter(Boolean)])] as string[];

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      if (user) {
        await api(`/api/users/${user.id}`, { method: "PATCH", body: { action: "update", reason, data: f } });
        onSaved("User updated");
      } else {
        await api("/api/users", { body: f });
        onSaved(`User ${f.employee_id.toUpperCase()} created with temporary password ${TEMP_PASSWORD}`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={user ? `Edit user — ${user.employee_id}` : "Add new user"}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (!!user && reason.trim().length < 3)} onClick={save}>
            {busy ? "Saving…" : user ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee ID" required>
          <input className={inputCls} value={f.employee_id} onChange={set("employee_id")} placeholder="e.g. QBD0123" />
        </Field>
        <Field label="Full Name" required>
          <input className={inputCls} value={f.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Email" required>
          <input type="email" className={inputCls} value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Designation" required>
          <input className={inputCls} value={f.designation} onChange={set("designation")} placeholder="e.g. Executive – QC" />
        </Field>
        <Field label="Joining Date" required>
          <input type="date" className={inputCls} value={f.joining_date} onChange={set("joining_date")} />
        </Field>
        <Field label="Reporting Manager">
          <select className={inputCls} value={f.reporting_manager_id ?? ""} onChange={(e) => setF((x) => ({ ...x, reporting_manager_id: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">— None —</option>
            {users
              .filter((u) => u.is_active && u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.employee_id})
                </option>
              ))}
          </select>
        </Field>
        <Field label="Department" required>
          <input className={inputCls} list="adm-depts" value={f.department} onChange={set("department")} placeholder="e.g. Quality Control" />
          <datalist id="adm-depts">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit" required>
            <input className={inputCls} list="adm-units" value={f.unit} onChange={set("unit")} />
            <datalist id="adm-units">
              {units.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Section">
            <input className={inputCls} value={f.section} onChange={set("section")} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Role(s)" required hint="Roles can be used in folder permissions. Administrators have full access everywhere.">
            <div className="flex flex-wrap gap-2">
              {ROLE_KEYS.map((r) => {
                const on = f.roles.includes(r);
                return (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setF((x) => ({ ...x, roles: on ? x.roles.filter((y) => y !== r) : [...x.roles, r] }))}
                    className={cx("rounded-full border px-3 py-1 text-xs", on ? "border-brand-700 bg-brand-700 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50")}
                  >
                    {ROLES[r]}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Justification" required hint="Why does this person need access? Recorded in the audit trail.">
            <textarea className={inputCls} rows={2} value={f.justification} onChange={set("justification")} />
          </Field>
        </div>
        {!user && (
          <div className="sm:col-span-2">
            <Field label="Password">
              <div className="flex items-center gap-3">
                <input className={`${inputCls} max-w-48 font-mono`} value={TEMP_PASSWORD} readOnly />
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <Info size={13} /> Temporary password. The user must change it at first sign-in.
                </span>
              </div>
            </Field>
          </div>
        )}
        {user && (
          <div className="sm:col-span-2">
            <Field label="Reason for change" required>
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Role change approved via CR-0456" />
            </Field>
          </div>
        )}
      </div>
      <ErrorText>{err}</ErrorText>
    </Modal>
  );
}
