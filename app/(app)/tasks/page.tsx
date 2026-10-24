"use client";

import { ClipboardCheck, FilePen, Hourglass, KeyRound, MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExcelIcon } from "@/components/icons";
import { Card, Empty, StatusBadge } from "@/components/ui";
import { api, fmtDate } from "@/lib/client";
import { PERMS, type Perm } from "@/lib/constants";

interface TaskFile {
  id: number;
  name: string;
  status: string;
  current_version: number;
  review_cycle: number;
  updated_at: string;
  path: string;
  open_annotations: number;
  addressed_annotations: number;
  submitted_at?: string;
  submit_comment?: string | null;
  submitted_by_name?: string;
  reviewer_name?: string;
  decision_comment?: string | null;
  decided_at?: string;
}
interface Tasks {
  toReview: TaskFile[];
  changesRequested: TaskFile[];
  inReview: TaskFile[];
  drafts: TaskFile[];
  myRequests: { id: number; resource_name: string; requested_perms: Perm[]; status: string; created_at: string; decided_by_name: string | null; decision_note: string | null }[];
  pendingAccessRequests: number;
}

function Row({ f, extra }: { f: TaskFile; extra?: React.ReactNode }) {
  return (
    <Link href={`/files/${f.id}`} className="flex items-center gap-3 border-b border-gray-100 px-5 py-3 last:border-0 hover:bg-brand-50/40">
      <ExcelIcon size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">{f.name}</span>
          <StatusBadge status={f.status} />
          <span className="text-[11px] text-gray-400">v{f.current_version}</span>
        </div>
        <div className="truncate text-xs text-gray-500">{f.path}</div>
        {extra && <div className="mt-0.5 text-xs text-gray-600">{extra}</div>}
      </div>
      {f.open_annotations > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{f.open_annotations} open</span>}
      {f.addressed_annotations > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{f.addressed_annotations} addressed</span>}
    </Link>
  );
}

export default function TasksPage() {
  const [t, setT] = useState<Tasks | null>(null);
  useEffect(() => {
    api<Tasks>("/api/tasks").then(setT).catch(() => {});
  }, []);
  if (!t) return <div className="p-10 text-center text-sm text-gray-400">Loading…</div>;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
        <p className="text-sm text-gray-500">Reviews waiting for you, workbooks sent back with annotations, and your submissions.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "To review", n: t.toReview.length, icon: ClipboardCheck, c: "text-blue-700 bg-blue-50" },
          { label: "Changes requested", n: t.changesRequested.length, icon: MessageSquareWarning, c: "text-amber-700 bg-amber-50" },
          { label: "Awaiting reviewer", n: t.inReview.length, icon: Hourglass, c: "text-gray-700 bg-gray-100" },
          { label: "My drafts", n: t.drafts.length, icon: FilePen, c: "text-brand-700 bg-brand-50" },
        ].map((k) => (
          <div key={k.label} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${k.c}`}>
              <k.icon size={20} />
            </span>
            <div>
              <div className="text-2xl font-bold text-gray-900">{k.n}</div>
              <div className="text-xs text-gray-500">{k.label}</div>
            </div>
          </div>
        ))}
      </div>
      {t.pendingAccessRequests > 0 && (
        <Link href="/admin?tab=requests" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <KeyRound size={16} /> {t.pendingAccessRequests} folder access request(s) are waiting for approval.
        </Link>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Waiting for my review">
          {t.toReview.length ? t.toReview.map((f) => <Row key={f.id} f={f} extra={`Cycle ${f.review_cycle} · from ${f.submitted_by_name} · ${fmtDate(f.submitted_at)}${f.submit_comment ? ` — “${f.submit_comment}”` : ""}`} />) : <Empty>Nothing to review.</Empty>}
        </Card>
        <Card title="Sent back to me — changes requested">
          {t.changesRequested.length ? t.changesRequested.map((f) => <Row key={f.id} f={f} extra={`${f.reviewer_name ?? "Reviewer"} · ${fmtDate(f.decided_at)}${f.decision_comment ? ` — “${f.decision_comment}”` : ""}`} />) : <Empty>No workbooks need changes.</Empty>}
        </Card>
        <Card title="My submissions in review">
          {t.inReview.length ? t.inReview.map((f) => <Row key={f.id} f={f} extra={`With ${f.reviewer_name} since ${fmtDate(f.submitted_at)}`} />) : <Empty>No submissions awaiting review.</Empty>}
        </Card>
        <Card title="My drafts">
          {t.drafts.length ? t.drafts.map((f) => <Row key={f.id} f={f} extra={`Last saved ${fmtDate(f.updated_at)}`} />) : <Empty>No drafts.</Empty>}
        </Card>
      </div>
      {t.myRequests.length > 0 && (
        <Card title="My access requests">
          <table className="w-full text-sm">
            <tbody>
              {t.myRequests.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-5 py-2">{r.resource_name}</td>
                  <td className="px-2 py-2 text-xs text-gray-600">{r.requested_perms.map((p) => PERMS[p]?.label ?? p).join(", ")}</td>
                  <td className="px-2 py-2 text-xs text-gray-500">{fmtDate(r.created_at)}</td>
                  <td className="px-5 py-2 text-right text-xs">
                    <span className={r.status === "APPROVED" ? "font-semibold text-green-700" : r.status === "REJECTED" ? "font-semibold text-red-700" : "text-amber-700"}>{r.status}</span>
                    {r.decided_by_name && <span className="text-gray-500"> by {r.decided_by_name}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
