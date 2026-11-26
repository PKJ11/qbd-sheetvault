// Shared between server and browser.

export const APP_NAME = "SheetVault";
export const APP_FULL_NAME = "QbD SheetVault";
export const APP_TAGLINE = "Controlled Spreadsheet Management System";
export const ORG_NAME = "QbD Research & Development Lab Pvt. Ltd.";
export const TEMP_PASSWORD = "Qbd@1234";
export const MAX_FAILED_LOGINS = 5;
export const IDLE_TIMEOUT_MIN = 15;

export const ROLES = {
  ADMIN: "System Administrator",
  QA: "QA Reviewer / Auditor",
  MANAGER: "Manager (Reviewer)",
  ANALYST: "Analyst (Author)",
  VIEWER: "Viewer",
} as const;
export type Role = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as Role[];

// Folder / file permission types (Windows-style ACL entries)
export const PERMS = {
  read: { label: "Read", help: "Open the folder, view and download files" },
  edit: { label: "Edit", help: "Enter data in input cells, rename, submit for review" },
  upload: { label: "Upload", help: "Upload new Excel files into the folder" },
  create: { label: "Create", help: "Create sub-folders and new files from templates" },
  delete: { label: "Delete", help: "Move folders and files to the Recycle Bin" },
  review: { label: "Review", help: "Annotate, request changes and approve files" },
  manage: { label: "Full control", help: "Change permissions (Security tab)" },
} as const;
export type Perm = keyof typeof PERMS;
export const PERM_KEYS = Object.keys(PERMS) as Perm[];

export const FILE_STATUS = {
  DRAFT: { label: "Draft", color: "#6b7280", bg: "#f3f4f6" },
  IN_REVIEW: { label: "Manager Review", color: "#1d4ed8", bg: "#dbeafe" },
  QA_REVIEW: { label: "QA Review", color: "#6d28d9", bg: "#ede9fe" },
  CHANGES_REQUESTED: { label: "Changes Requested", color: "#b45309", bg: "#fef3c7" },
  APPROVED: { label: "Approved", color: "#166534", bg: "#dcfce7" },
} as const;
export type FileStatus = keyof typeof FILE_STATUS;

// Two-stage approval: a manager of the author's department approves first, then anyone in QA.
// A QA member is a user with the QA role or whose department is QA_DEPARTMENT.
export const QA_DEPARTMENT = "Quality Assurance";
export const REVIEW_STAGE = {
  MANAGER: "Department manager",
  QA: "QA department",
} as const;
export type ReviewStage = keyof typeof REVIEW_STAGE;

export const PRINCIPAL_TYPES = ["user", "role", "department", "everyone"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 8) p.push("at least 8 characters");
  if (!/[A-Z]/.test(pw)) p.push("an uppercase letter");
  if (!/[a-z]/.test(pw)) p.push("a lowercase letter");
  if (!/\d/.test(pw)) p.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) p.push("a special character");
  return p;
}
