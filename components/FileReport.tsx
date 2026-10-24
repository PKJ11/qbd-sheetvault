"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "./icons";
import { Button, StatusBadge } from "./ui";
import { api, fmtBytes, fmtDate } from "@/lib/client";
import { APP_FULL_NAME, ORG_NAME } from "@/lib/constants";

interface History {
  file: { id: number; name: string; status: string; current_version: number; review_cycle: number; owner_name: string; owner_employee_id: string; created_at: string; updated_at: string };
  path: string;
  versions: { version_no: number; created_at: string; reason: string | null; size_bytes: number; sha256: string; by: string; employee_id: string }[];
  reviews: {
    id: number;
    cycle_no: number;
    version_no: number;
    submitted_by_name: string;
    submitted_by_employee_id: string;
    submitted_at: string;
    submit_comment: string | null;
    reviewer_name: string;
    reviewer_employee_id: string;
    decision: string | null;
    decided_at: string | null;
    decision_comment: string | null;
    annotations: number;
  }[];
  annotations: {
    id: number;
    sheet: string | null;
    cell: string | null;
    comment: string;
    status: string;
    version_no: number;
    created_by_name: string;
    created_at: string;
    response: string | null;
    responded_by_name: string | null;
    responded_at: string | null;
    closed_by_name: string | null;
    closed_at: string | null;
  }[];
  changes: { id: number; version_no: number; sheet: string; cell: string; old_value: string | null; new_value: string | null; reason: string | null; by: string; employee_id: string; changed_at: string }[];
  audit: { id: string; ts: string; employee_id: string; user_name: string; action: string; reason: string | null; details: unknown }[];
  generatedAt: string;
  generatedBy: string;
}

const th = "border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold";
const td = "border border-gray-300 px-2 py-1 align-top";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 break-inside-avoid-page">
      <h2 className="mb-2 border-b-2 border-brand-700 pb-1 text-sm font-bold uppercase tracking-wide text-brand-900">{title}</h2>
      {children}
    </section>
  );
}

export function FileReport({ id }: { id: number }) {
  const [h, setH] = useState<History | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<History>(`/api/files/${id}/history`).then(setH).catch((e) => setErr(e.message));
  }, [id]);
  if (err) return <div className="p-10 text-center text-red-600">{err}</div>;
  if (!h) return <div className="p-10 text-center text-gray-400">Generating report…</div>;

  const decisionLabel = (d: string | null) => (d === "APPROVED" ? "Approved" : d === "CHANGES_REQUESTED" ? "Changes requested" : d === "WITHDRAWN" ? "Withdrawn" : "Pending");

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/files/${id}`} className="flex items-center gap-1 text-sm text-gray-600 hover:text-brand-700">
          <ArrowLeft size={15} /> Back to workbook
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={15} /> Print / Save as PDF
        </Button>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-[12px] shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 flex items-start justify-between border-b border-gray-300 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-brand-700 p-0.5">
              <BrandMark size={40} />
            </div>
            <div>
              <div className="text-base font-bold text-gray-900">Workbook Review & Change Report</div>
              <div className="text-gray-500">
                {ORG_NAME} · {APP_FULL_NAME}
              </div>
            </div>
          </div>
          <div className="text-right text-[11px] text-gray-500">
            Generated {fmtDate(h.generatedAt)}
            <br />
            by {h.generatedBy}
          </div>
        </header>

        <Section title="1. Document">
          <table className="w-full border-collapse">
            <tbody>
              {[
                ["File", h.file.name],
                ["Location", h.path],
                ["Status", <StatusBadge key="s" status={h.file.status} />],
                ["Current version", `v${h.file.current_version}`],
                ["Review cycles", h.file.review_cycle],
                ["Author", `${h.file.owner_name} (${h.file.owner_employee_id})`],
                ["Created", fmtDate(h.file.created_at)],
                ["Last modified", fmtDate(h.file.updated_at)],
              ].map(([k, v]) => (
                <tr key={String(k)}>
                  <td className={`${th} w-48`}>{k}</td>
                  <td className={td}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="2. Review cycles & electronic signatures">
          {h.reviews.length === 0 ? (
            <p className="text-gray-500">Not yet submitted for review.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Cycle", "Version", "Submitted by / on", "Reviewer", "Decision / on", "Comments", "Notes"].map((x) => (
                    <th key={x} className={th}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h.reviews.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.cycle_no}</td>
                    <td className={td}>v{r.version_no}</td>
                    <td className={td}>
                      {r.submitted_by_name} ({r.submitted_by_employee_id})<br />
                      <span className="text-gray-500">{fmtDate(r.submitted_at)}</span>
                      {r.submit_comment && <div className="mt-1 italic">“{r.submit_comment}”</div>}
                    </td>
                    <td className={td}>
                      {r.reviewer_name} ({r.reviewer_employee_id})
                    </td>
                    <td className={td}>
                      <b>{decisionLabel(r.decision)}</b>
                      <br />
                      <span className="text-gray-500">{fmtDate(r.decided_at)}</span>
                    </td>
                    <td className={td}>{r.decision_comment}</td>
                    <td className={td}>{r.annotations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="3. Reviewer annotations">
          {h.annotations.length === 0 ? (
            <p className="text-gray-500">No annotations.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["#", "Cell", "Annotation", "Author response", "Status"].map((x) => (
                    <th key={x} className={th}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h.annotations.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{a.id}</td>
                    <td className={`${td} font-mono`}>{a.cell ? `${a.sheet}!${a.cell}` : "General"}</td>
                    <td className={td}>
                      {a.comment}
                      <div className="text-[10px] text-gray-500">
                        {a.created_by_name} · {fmtDate(a.created_at)} · on v{a.version_no}
                      </div>
                    </td>
                    <td className={td}>
                      {a.response ?? <span className="text-gray-400">—</span>}
                      {a.responded_by_name && (
                        <div className="text-[10px] text-gray-500">
                          {a.responded_by_name} · {fmtDate(a.responded_at)}
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      {a.status}
                      {a.closed_by_name && (
                        <div className="text-[10px] text-gray-500">
                          by {a.closed_by_name} · {fmtDate(a.closed_at)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="4. Cell change log">
          {h.changes.length === 0 ? (
            <p className="text-gray-500">No input cells have been changed.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Version", "Cell", "Old value", "New value", "Reason", "Changed by / on"].map((x) => (
                    <th key={x} className={th}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h.changes.map((c) => (
                  <tr key={c.id}>
                    <td className={td}>v{c.version_no}</td>
                    <td className={`${td} font-mono`}>
                      {c.sheet}!{c.cell}
                    </td>
                    <td className={td}>{c.old_value ?? <span className="text-gray-400">(blank)</span>}</td>
                    <td className={td}>{c.new_value ?? <span className="text-gray-400">(blank)</span>}</td>
                    <td className={td}>{c.reason}</td>
                    <td className={td}>
                      {c.by} ({c.employee_id})<br />
                      <span className="text-gray-500">{fmtDate(c.changed_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="5. Version history">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Version", "Saved by / on", "Reason", "Size", "SHA-256"].map((x) => (
                  <th key={x} className={th}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.versions.map((v) => (
                <tr key={v.version_no}>
                  <td className={td}>v{v.version_no}</td>
                  <td className={td}>
                    {v.by} ({v.employee_id})<br />
                    <span className="text-gray-500">{fmtDate(v.created_at)}</span>
                  </td>
                  <td className={td}>{v.reason}</td>
                  <td className={td}>{fmtBytes(v.size_bytes)}</td>
                  <td className={`${td} break-all font-mono text-[9px]`}>{v.sha256}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="6. Audit trail">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Seq", "Timestamp", "User", "Action", "Reason"].map((x) => (
                  <th key={x} className={th}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.audit.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.id}</td>
                  <td className={`${td} whitespace-nowrap`}>{fmtDate(a.ts)}</td>
                  <td className={td}>
                    {a.user_name} ({a.employee_id})
                  </td>
                  <td className={td}>{a.action.replace(/_/g, " ").toLowerCase()}</td>
                  <td className={td}>{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <footer className="mt-8 border-t border-gray-300 pt-2 text-center text-[10px] text-gray-500">
          Computer-generated report from {APP_FULL_NAME}. Records are maintained in a hash-chained, append-only audit trail.
        </footer>
      </div>
    </div>
  );
}
