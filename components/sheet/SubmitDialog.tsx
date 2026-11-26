"use client";

import { useEffect, useState } from "react";
import { Button, ErrorText, Field, inputCls, Modal } from "../ui";
import { api } from "@/lib/client";

interface Reviewer {
  id: number;
  employee_id: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  isReportingManager: boolean;
}

export function SubmitDialog({ fileId, resubmit, onClose, onDone }: { fileId: number; resubmit: boolean; onClose: () => void; onDone: () => void }) {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState<number | "">("");
  const [comment, setComment] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ reviewers: Reviewer[]; department: string | null }>(`/api/files/${fileId}/reviewers`)
      .then((r) => {
        setReviewers(r.reviewers);
        setDepartment(r.department);
        const rm = r.reviewers.find((x) => x.isReportingManager);
        if (rm) setReviewerId(rm.id);
      })
      .catch((e) => setErr(e.message));
  }, [fileId]);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/files/${fileId}/submit`, { body: { reviewerId, comment, password } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={resubmit ? "Resubmit for review" : "Submit for review"}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!reviewerId || !password || busy} onClick={submit}>
            {busy ? "Submitting…" : "Sign & submit"}
          </Button>
        </>
      }
    >
      <ol className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600">
        <li className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">1. Department manager approves</li>
        <li aria-hidden>→</li>
        <li className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800">2. QA department gives final approval</li>
        <li aria-hidden>→</li>
        <li className="rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-800">Locked + copy filed in QA</li>
      </ol>
      <p className="mb-4 text-gray-600">The file is locked for editing while it is under review. Either reviewer can annotate cells and send it back to you for changes.</p>
      <div className="space-y-4">
        <Field
          label={department ? `Manager of ${department}` : "Department manager"}
          required
          hint="Only managers of the author's department with Review permission on this file are listed. You can't review your own work."
        >
          <select className={inputCls} value={reviewerId} onChange={(e) => setReviewerId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">{reviewers ? (reviewers.length ? "Select manager…" : department ? `No eligible manager in ${department}` : "The author has no department") : "Loading…"}</option>
            {reviewers?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name} ({r.employee_id}){r.designation ? ` · ${r.designation}` : ""}
                {r.isReportingManager ? " — your reporting manager" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={resubmit ? "Summary of changes made" : "Comments for the reviewer"}>
          <textarea className={inputCls} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <div className="rounded-md border border-brand-200 bg-brand-50 p-3">
          <div className="mb-2 text-xs font-semibold text-brand-800">Electronic signature — meaning: “Submitted for review”</div>
          <Field label="Re-enter your password to sign" required>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
      </div>
      <ErrorText>{err}</ErrorText>
    </Modal>
  );
}
