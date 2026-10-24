"use client";

import { ChevronLeft, ChevronRight, Download, ShieldCheck, ShieldX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, inputCls, useToast } from "@/components/ui";
import { api, fmtDate } from "@/lib/client";

interface Row {
  id: string;
  ts: string;
  employee_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  details: unknown;
  reason: string | null;
  ip: string | null;
  hash: string;
}

function Details({ d }: { d: unknown }) {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  return (
    <div className="space-y-0.5">
      {Object.entries(o).map(([k, v]) => {
        if (k === "changes" && Array.isArray(v))
          return (
            <div key={k}>
              <span className="text-gray-500">changes:</span>
              <ul className="ml-3 font-mono text-[10px]">
                {(v as { cell: string; old: unknown; new: unknown }[]).map((c, i) => (
                  <li key={i}>
                    {c.cell}: <span className="text-red-600">{String(c.old ?? "∅")}</span> → <span className="text-green-700">{String(c.new ?? "∅")}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        return (
          <div key={k} className="break-words">
            <span className="text-gray-500">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </div>
        );
      })}
    </div>
  );
}

export default function AuditPage() {
  const toast = useToast();
  const [f, setF] = useState({ user: "", action: "", entityType: "", from: "", to: "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; total: number; size: number; actions: string[] } | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; brokenAt?: string } | null>(null);
  const [err, setErr] = useState("");
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  const load = useCallback(() => {
    api<typeof data>(`/api/audit?${qs}&page=${page}&size=50`)
      .then((d) => (setData(d), setErr("")))
      .catch((e) => setErr(e.message));
  }, [qs, page]);
  useEffect(() => {
    load();
  }, [load]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  if (err) return <div className="p-10 text-center text-red-600">{err}</div>;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
          <p className="text-sm text-gray-500">Append-only, hash-chained record of who did what, when, and why (21 CFR Part 11 / EU GMP Annex 11).</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              try {
                const r = await api<{ ok: boolean; checked: number; brokenAt?: string }>("/api/audit/verify", { method: "POST" });
                setVerify(r);
                load();
              } catch (e) {
                toast((e as Error).message, "err");
              }
            }}
          >
            <ShieldCheck size={15} /> Verify integrity
          </Button>
          <a href={`/api/audit?${qs}${qs ? "&" : ""}format=csv`}>
            <Button>
              <Download size={15} /> Export CSV
            </Button>
          </a>
        </div>
      </div>
      {verify && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${verify.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {verify.ok ? <ShieldCheck size={16} /> : <ShieldX size={16} />}
          {verify.ok ? `Integrity verified: all ${verify.checked} records match the hash chain.` : `Integrity FAILED at record #${verify.brokenAt} (after ${verify.checked} valid records). Investigate immediately.`}
        </div>
      )}
      <Card
        title={`${data?.total ?? "…"} records`}
        actions={
          <div className="flex flex-wrap gap-2">
            <input className={`${inputCls} h-8 w-40 py-1 text-xs`} placeholder="User / Emp ID" value={f.user} onChange={set("user")} />
            <select className={`${inputCls} h-8 w-48 py-1 text-xs`} value={f.action} onChange={set("action")}>
              <option value="">All actions</option>
              {data?.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select className={`${inputCls} h-8 w-32 py-1 text-xs`} value={f.entityType} onChange={set("entityType")}>
              <option value="">All entities</option>
              {["file", "folder", "user", "auth", "report", "system"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input type="date" className={`${inputCls} h-8 w-36 py-1 text-xs`} value={f.from} onChange={set("from")} />
            <input type="date" className={`${inputCls} h-8 w-36 py-1 text-xs`} value={f.to} onChange={set("to")} />
            <input className={`${inputCls} h-8 w-40 py-1 text-xs`} placeholder="Search details" value={f.q} onChange={set("q")} />
          </div>
        }
      >
        {!data ? (
          <Empty>Loading…</Empty>
        ) : data.rows.length === 0 ? (
          <Empty>No records.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  {["#", "When (local)", "Who", "Action", "Entity", "Details", "Reason", "IP"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 text-gray-400" title={`hash ${r.hash}`}>
                      {r.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.ts)}</td>
                    <td className="px-3 py-2">
                      {r.user_name ?? "—"}
                      <div className="text-[10px] text-gray-500">{r.employee_id}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${/FAILED|DELETED|LOCKED|REJECTED/.test(r.action) ? "bg-red-50 text-red-700" : /APPROVED|GRANTED|RESTORED/.test(r.action) ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-700"}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-gray-500">{r.entity_type}</span>
                      {r.entity_id && <span className="text-gray-400"> #{r.entity_id}</span>}
                      <div className="max-w-[220px] break-words">{r.entity_name}</div>
                    </td>
                    <td className="max-w-[360px] px-3 py-2">
                      <Details d={r.details} />
                    </td>
                    <td className="max-w-[200px] px-3 py-2">{r.reason}</td>
                    <td className="px-3 py-2 text-gray-500">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-2 text-xs">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={14} />
          </Button>
          Page {page} of {pages}
          <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </Card>
    </div>
  );
}
