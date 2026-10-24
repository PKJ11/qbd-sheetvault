import "server-only";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { audit } from "./audit";
import { actorOf, type User } from "./auth";
import type { Perm } from "./constants";
import { one, q, type Db } from "./db";
import type { WorkbookModel } from "./excel/model";
import { HttpError } from "./http";
import { Acl, assertPerm } from "./permissions";

export interface FileRow {
  id: number;
  folder_id: number;
  name: string;
  owner_id: number;
  status: "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
  current_version: number;
  review_cycle: number;
  inherit_permissions: boolean;
  size_bytes: number;
  created_at: Date;
  updated_at: Date;
  updated_by: number | null;
  deleted_at: Date | null;
}

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function sha256(buf: Buffer | Uint8Array) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function getFile(id: number, db?: Db, forUpdate = false): Promise<FileRow> {
  const f = await one<FileRow>(
    `SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
    db,
  );
  if (!f) throw new HttpError(404, "File not found.");
  return f;
}

/** Load a file and the caller's effective permissions on it; asserts `need`. */
export async function fileAccess(u: User, id: number, need: Perm, db?: Db, forUpdate = false) {
  const [file, acl] = await Promise.all([getFile(id, db, forUpdate), Acl.load(db, [id])]);
  const perms = acl.filePerms(u, file);
  assertPerm(perms, need, `"${file.name}"`);
  return { file, perms, acl };
}

export async function storeVersion(
  db: Db,
  fileId: number,
  versionNo: number,
  buf: Buffer,
  model: WorkbookModel,
  userId: number,
  reason: string | null,
) {
  await db.query(
    `INSERT INTO file_versions (file_id, version_no, content, sha256, model, size_bytes, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [fileId, versionNo, buf, sha256(buf), JSON.stringify(model), buf.length, reason, userId],
  );
}

// Saved versions are immutable, so their parsed models can be cached in memory.
const MODEL_CACHE_SIZE = 40;
const g = globalThis as unknown as { __svModels?: Map<string, WorkbookModel> };
const modelCache = (g.__svModels ??= new Map<string, WorkbookModel>());

export async function versionModel(fileId: number, versionNo: number): Promise<WorkbookModel | null> {
  const key = `${fileId}:${versionNo}`;
  const hit = modelCache.get(key);
  if (hit) {
    modelCache.delete(key);
    modelCache.set(key, hit); // most recently used last
    return hit;
  }
  const row = await one<{ model: WorkbookModel }>("SELECT model FROM file_versions WHERE file_id = $1 AND version_no = $2", [fileId, versionNo]);
  if (!row) return null;
  modelCache.set(key, row.model);
  if (modelCache.size > MODEL_CACHE_SIZE) modelCache.delete(modelCache.keys().next().value!);
  return row.model;
}

export async function versionContent(fileId: number, versionNo: number, db?: Db) {
  const v = await one<{ content: Buffer; sha256: string }>(
    "SELECT content, sha256 FROM file_versions WHERE file_id = $1 AND version_no = $2",
    [fileId, versionNo],
    db,
  );
  if (!v) throw new HttpError(404, "Version not found.");
  if (sha256(v.content) !== v.sha256) throw new HttpError(500, "Integrity check failed for this version.");
  return v.content;
}

/** Pick "name (2).xlsx" style name when the name is taken in the folder. */
export async function uniqueFileName(db: Db, folderId: number, name: string): Promise<string> {
  const rows = await q<{ name: string }>(
    "SELECT name FROM files WHERE folder_id = $1 AND deleted_at IS NULL",
    [folderId],
    db,
  );
  const taken = new Set(rows.map((r) => r.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

export function cleanName(raw: unknown, what = "Name"): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) throw new HttpError(400, `${what} is required.`);
  if (s.length > 180) throw new HttpError(400, `${what} is too long.`);
  if (/[\\/:*?"<>|]/.test(s)) throw new HttpError(400, `${what} can't contain any of: \\ / : * ? " < > |`);
  return s;
}

export function requireReason(raw: unknown, what = "A reason"): string {
  const s = String(raw ?? "").trim();
  if (s.length < 3) throw new HttpError(400, `${what} is required (21 CFR Part 11).`);
  return s.slice(0, 1000);
}

/** Electronic signature: re-authenticate with the account password. Failures are audited. */
export async function verifyESignature(u: User, password: unknown, fileId?: number) {
  const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [u.id]);
  if (!row || typeof password !== "string" || !(await bcrypt.compare(password, row.password_hash))) {
    await audit(await actorOf(u), { action: "ESIGNATURE_FAILED", entityType: fileId ? "file" : "user", entityId: fileId ?? u.id });
    // 403, not 401: the session is still valid, so the client must not treat this as a sign-out.
    throw new HttpError(403, "Electronic signature failed: the password is incorrect. Use your current sign-in password (not the temporary one).");
  }
}

export function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}
