import type { Perm } from "@/lib/constants";
import type { WorkbookModel } from "@/lib/excel/model";

export interface Annotation {
  id: number;
  review_id: number | null;
  version_no: number;
  sheet: string | null;
  cell: string | null;
  comment: string;
  status: "OPEN" | "ADDRESSED" | "CLOSED";
  created_by: number;
  created_by_name: string;
  created_at: string;
  response: string | null;
  responded_by_name: string | null;
  responded_at: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  /** Stage of the review the annotation was raised (or re-opened) in. */
  review_stage: "MANAGER" | "QA" | null;
}

export interface AnnotationMessage {
  id: number;
  annotation_id: number;
  kind: "COMMENT" | "RESPONSE" | "REOPEN" | "CLOSE";
  text: string | null;
  version_no: number;
  by_name: string;
  created_at: string;
}

export interface Review {
  id: number;
  cycle_no: number;
  version_no: number;
  submitted_by: number;
  submitted_by_name: string;
  submitted_at: string;
  submit_comment: string | null;
  stage: "MANAGER" | "QA";
  /** NULL while a QA review waits in the shared QA queue. */
  reviewer_id: number | null;
  reviewer_name: string | null;
  decision: "APPROVED" | "CHANGES_REQUESTED" | "WITHDRAWN" | null;
  decided_at: string | null;
  decision_comment: string | null;
}

export interface Version {
  version_no: number;
  created_at: string;
  reason: string | null;
  size_bytes: number;
  sha256: string;
  by: string;
  employee_id: string;
}

export interface FileData {
  file: {
    id: number;
    name: string;
    folder_id: number;
    status: "DRAFT" | "IN_REVIEW" | "QA_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
    source_file_id: number | null;
    current_version: number;
    review_cycle: number;
    owner_id: number;
    owner_name: string;
    owner_employee_id: string;
    updated_at: string;
  };
  path: { id: number; name: string }[];
  perms: Perm[];
  isOwner: boolean;
  isReviewer: boolean;
  /** QA-approved copy filed under Quality Assurance (on the original). */
  qaCopy: { id: number; name: string } | null;
  /** The original workbook (on a QA copy). */
  source: { id: number; name: string } | null;
  versionNo: number;
  version: { created_at: string; reason: string | null; by: string; sha256: string };
  model: WorkbookModel;
  versions: Version[];
  annotations: Annotation[];
  messages: AnnotationMessage[];
  reviews: Review[];
  activeReview: Review | null;
  changedSinceReview: { sheet: string; cell: string; old_value: string | null; new_value: string | null; version_no: number }[];
  lastReviewedVersion: number | null;
  checkout: { id: number; user_id: number; user_name: string; employee_id: string; started_at: string; working_saved_at: string | null; base_version: number; mine: boolean } | null;
  editorAvailable: boolean;
}
