"use client";

import { Download, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, inputCls, StatusBadge } from "@/components/ui";
import { api, fmtDate } from "@/lib/client";
import { FILE_STATUS, type FileStatus } from "@/lib/constants";

interface Row {
  id: number;
  name: string;
  path: string;
  status: FileStatus;
  current_version: number;
  review_cycle: number;
  changes_requested: number;
  owner: string;
  department: string | null;
  reviewer: string | null;
  approved_by: string | null;
  approved_at: string | null;
  ann_total: number;
  ann_open: number;
  ann_addressed: number;
  ann_closed: number;
  cell_changes: number;
  avg_review_hours: number | null;
  updated_at: string;
}
interface Report {
  rows: Row[];
  summary: { total: number; byStatus: Record<string, number>; openAnnotations: number; addressedAnnotations: number; closedAnnotations: number; reviewCycles: number; avgReviewHours: number | null };
  departments: string[];
  scope: "all" | "accessible";
}

export default function ReportsPage() {
  const [filters, setFilters] = useState({ status: "", department: "", from: "", to: "", q: "" });
  const [r, setR] = useState<Report | null>(null);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const load = useCallback(() => {
    api<Report>(`/api/reports?${qs}`).then(setR).catch(() => {});
  }, [qs]);
  useEffect(() => {
    load();
  }, [load]);
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const s = r?.summary;
  const max = Math.max(1, ...Object.values(s?.byStatus ?? {}));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Reports</h1>
          <p className="text-sm text-gray-500">Status of every workbook, its review cycles, annotations and changes. {r?.scope === "accessible" && "Showing workbooks you have access to."}</p>
        </div>
        <a href={`/api/reports?${qs}${qs ? "&" : ""}format=csv`}>
          <Button>
            <Download size={15} /> Export CSV
          </Button>
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Workbooks", s?.total],
          ["Review cycles", s?.reviewCycles],
          ["Open annotations", s?.openAnnotations],
          ["Addressed (awaiting reviewer)", s?.addressedAnnotations],
          ["Avg. review time", s?.avgReviewHours != null ? `${s.avgReviewHours} h` : "—"],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-2xl font-bold text-gray-900">{v ?? "…"}</div>
            <div className="text-xs text-gray-500">{k}</div>
          </div>
        ))}
      </div>

      <Card title="Workbooks by status">
        <div className="space-y-2 p-5">
          {(Object.keys(FILE_STATUS) as FileStatus[]).map((st) => {
            const n = s?.byStatus[st] ?? 0;
            return (
              <div key={st} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0">
                  <StatusBadge status={st} />
                </span>
                <div className="h-4 flex-1 rounded bg-gray-100">
                  <div className="h-4 rounded" style={{ width: `${(n / max) * 100}%`, background: FILE_STATUS[st].color, opacity: 0.75 }} />
                </div>
                <span className="w-10 text-right font-semibold tabular-nums">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Workbook review register"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input className={`${inputCls} h-8 w-48 py-1 pl-8 text-xs`} placeholder="Search file name" value={filters.q} onChange={set("q")} />
            </div>
            <select className={`${inputCls} h-8 w-40 py-1 text-xs`} value={filters.status} onChange={set("status")}>
              <option value="">All statuses</option>
              {(Object.keys(FILE_STATUS) as FileStatus[]).map((k) => (
                <option key={k} value={k}>
                  {FILE_STATUS[k].label}
                </option>
              ))}
            </select>
            <select className={`${inputCls} h-8 w-40 py-1 text-xs`} value={filters.department} onChange={set("department")}>
              <option value="">All departments</option>
              {r?.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <input type="date" className={`${inputCls} h-8 w-36 py-1 text-xs`} value={filters.from} onChange={set("from")} title="Modified from" />
            <input type="date" className={`${inputCls} h-8 w-36 py-1 text-xs`} value={filters.to} onChange={set("to")} title="Modified to" />
          </div>
        }
      >
        {!r ? (
          <Empty>Loading…</Empty>
        ) : r.rows.length === 0 ? (
          <Empty>No workbooks match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  {["Workbook", "Status", "Ver.", "Cycles", "Sent back", "Author", "Reviewer", "Approved", "Annotations (open/addr./closed)", "Cell changes", "Avg review", "Updated"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.id} className="border-t border-gray-100 hover:bg-brand-50/40">
                    <td className="px-3 py-2">
                      <Link href={`/files/${x.id}/report`} className="font-medium text-brand-800 hover:underline">
                        {x.name}
                      </Link>
                      <div className="text-[10px] text-gray-500">{x.path}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={x.status} />
                    </td>
                    <td className="px-3 py-2">v{x.current_version}</td>
                    <td className="px-3 py-2">{x.review_cycle}</td>
                    <td className="px-3 py-2">{x.changes_requested}</td>
                    <td className="px-3 py-2">
                      {x.owner}
                      <div className="text-[10px] text-gray-500">{x.department}</div>
                    </td>
                    <td className="px-3 py-2">{x.reviewer ?? "—"}</td>
                    <td className="px-3 py-2">{x.approved_by ? `${x.approved_by}, ${fmtDate(x.approved_at, false)}` : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <span className="text-red-700">{x.ann_open}</span> / <span className="text-amber-700">{x.ann_addressed}</span> / <span className="text-green-700">{x.ann_closed}</span>
                    </td>
                    <td className="px-3 py-2">{x.cell_changes}</td>
                    <td className="px-3 py-2">{x.avg_review_hours != null ? `${x.avg_review_hours} h` : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{fmtDate(x.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
