"use client";

import { Check, KeyRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/AuthLayout";
import { api } from "@/lib/client";
import { passwordProblems } from "@/lib/constants";

const RULES = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "An uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), label: "A lowercase letter" },
  { test: (p: string) => /\d/.test(p), label: "A number" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "A special character" },
];

export default function ChangePasswordPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ full_name: string; must_change_password: boolean } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ user: { full_name: string; must_change_password: boolean } }>("/api/auth/me").then((r) => setMe(r.user)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (next !== confirm) return setError("The new passwords don't match.");
    if (passwordProblems(next).length) return setError("The new password doesn't meet the policy.");
    setBusy(true);
    try {
      await api("/api/auth/change-password", { body: { currentPassword: current, newPassword: next } });
      router.replace("/explorer");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  };

  const input = "w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-200";
  return (
    <AuthLayout>
      <div className="mb-6">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
          <KeyRound size={20} />
        </div>
        <h2 className="mb-1 text-2xl font-bold text-gray-900">{me?.must_change_password ? "Set your own password" : "Change password"}</h2>
        <p className="text-sm text-gray-500">
          {me?.must_change_password
            ? `Welcome${me ? `, ${me.full_name}` : ""}. You signed in with a temporary password. Choose a new one to continue.`
            : "Choose a new password for your account."}
        </p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">{me?.must_change_password ? "Temporary password" : "Current password"}</label>
          <input type="password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">New password</label>
          <input type="password" className={input} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Confirm new password</label>
          <input type="password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-gray-200 bg-white p-3 text-xs">
          {RULES.map((r) => {
            const ok = r.test(next);
            return (
              <li key={r.label} className={ok ? "flex items-center gap-1.5 text-green-700" : "flex items-center gap-1.5 text-gray-500"}>
                {ok ? <Check size={12} /> : <X size={12} />} {r.label}
              </li>
            );
          })}
          <li className={next && next === confirm ? "flex items-center gap-1.5 text-green-700" : "flex items-center gap-1.5 text-gray-500"}>
            {next && next === confirm ? <Check size={12} /> : <X size={12} />} Passwords match
          </li>
        </ul>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-700 py-3 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
          {busy ? "Saving…" : "Update password"}
        </button>
        <div className="flex justify-between text-xs">
          {!me?.must_change_password ? (
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => router.back()}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="font-medium text-gray-500 hover:underline" onClick={signOut}>
            Sign out
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
