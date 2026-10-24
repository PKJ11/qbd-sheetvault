"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthLayout } from "@/components/AuthLayout";
import { api } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("expired") ? "You were signed out after a period of inactivity." : "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ mustChangePassword: boolean }>("/api/auth/login", { body: { employeeId, password } });
      const next = params.get("next");
      router.replace(r.mustChangePassword ? "/change-password" : next && next.startsWith("/") ? next : "/explorer");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const input = "w-full rounded-lg border px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-brand-200";
  return (
    <>
      <div className="mb-8">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "#2d6a4f" }}>
          Secure sign-in
        </div>
        <h2 className="mb-1 text-3xl font-bold text-gray-900">Sign in to SheetVault</h2>
        <p className="text-sm text-gray-500">Use your Employee ID and password to continue.</p>
      </div>
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="eid">
            Employee ID
          </label>
          <input id="eid" className={input} style={{ borderColor: "#d1d5db", background: "#fff", color: "#111827" }} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} autoComplete="username" autoFocus required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="pw">
            Password
          </label>
          <input id="pw" type="password" className={input} style={{ borderColor: "#d1d5db", background: "#fff", color: "#111827" }} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white transition-all disabled:opacity-60" style={{ background: "#2d6a4f" }}>
          {busy ? "Signing in…" : "Sign in"} {!busy && <ArrowRight size={16} />}
        </button>
        <div className="flex items-start gap-2 rounded-lg px-4 py-3 text-xs" style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <span>All sign-ins, changes and approvals are recorded in a tamper-evident audit trail.</span>
        </div>
        <p className="text-center text-xs text-gray-400">Need access? Contact your System Administrator.</p>
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
