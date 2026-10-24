"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { FILE_STATUS, type FileStatus } from "@/lib/constants";
import { cx } from "@/lib/client";

// ---------- Buttons ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" };
export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-brand-700 text-white hover:bg-brand-800",
        variant === "secondary" && "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "text-gray-700 hover:bg-gray-100",
        className,
      )}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = FILE_STATUS[status as FileStatus] ?? { label: status, color: "#374151", bg: "#f3f4f6" };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

export function Field({ label, children, hint, required }: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-200 disabled:bg-gray-50";

// ---------- Modal (Windows 11 dialog look) ----------
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
  icon,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  icon?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="win flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-gray-300 bg-[#f9f9f9] shadow-2xl" style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <div className="flex h-9 items-center gap-2 border-b border-gray-200 bg-white pl-3">
          {icon}
          <span className="flex-1 truncate text-[12px]">{title}</span>
          <button onClick={onClose} className="flex h-9 w-11 items-center justify-center hover:bg-[#c42b1c] hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto p-5 text-[13px]">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-200 bg-[#f3f3f3] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{children}</div>;
}

/** Dialog that asks for a reason (and optional e-signature password) before an action. */
export function ReasonDialog({
  title,
  message,
  confirmLabel,
  danger,
  requireSignature,
  reasonLabel = "Reason",
  reasonRequired = true,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireSignature?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
  onConfirm: (reason: string, password: string) => Promise<void>;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await onConfirm(reason.trim(), password);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ok = (!reasonRequired || reason.trim().length >= 3) && (!requireSignature || password.length > 0);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={!ok || busy} onClick={submit}>
            {busy ? "Please wait…" : confirmLabel}
          </Button>
        </>
      }
    >
      {message && <div className="mb-4 text-gray-700">{message}</div>}
      {children}
      <Field label={reasonLabel} required={reasonRequired}>
        <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {requireSignature && (
        <div className="mt-4 rounded-md border border-brand-200 bg-brand-50 p-3">
          <div className="mb-2 text-xs font-semibold text-brand-800">Electronic signature (21 CFR Part 11)</div>
          <Field label="Re-enter your password to sign" required>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && ok && submit()} />
          </Field>
        </div>
      )}
      <ErrorText>{err}</ErrorText>
    </Modal>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; kind: "ok" | "err" };
const ToastCtx = createContext<(text: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg",
              t.kind === "ok" ? "border-brand-200 bg-white text-brand-900" : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Card({ title, children, actions, className }: { title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-gray-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-gray-400">{children}</div>;
}
