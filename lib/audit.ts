import "server-only";
import { createHash } from "crypto";
import { one, q, tx, type Db } from "./db";

export interface Actor {
  id: number | null;
  employee_id: string | null;
  full_name: string | null;
  ip?: string | null;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  entityName?: string | null;
  details?: unknown;
  reason?: string | null;
}

const GENESIS = "0".repeat(64);

interface AuditRow {
  id: string;
  ts: Date;
  user_id: number | null;
  employee_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  details: unknown;
  reason: string | null;
  ip: string | null;
  prev_hash: string;
  hash: string;
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

function computeHash(prev: string, r: Omit<AuditRow, "id" | "prev_hash" | "hash">): string {
  const payload = canonical({
    ts: r.ts.toISOString(),
    user_id: r.user_id,
    employee_id: r.employee_id,
    user_name: r.user_name,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    entity_name: r.entity_name,
    details: r.details ?? null,
    reason: r.reason,
    ip: r.ip,
  });
  return createHash("sha256").update(prev + "|" + payload).digest("hex");
}

/**
 * Append an audit record. Must run inside a transaction (pass the tx client) so the
 * hash chain is serialised with an advisory lock. Use `audit()` for standalone events.
 */
export async function writeAudit(db: Db, actor: Actor, a: AuditInput): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(7311)");
  const last = await one<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1", [], db);
  const prev = last?.hash ?? GENESIS;
  const row = {
    ts: new Date(),
    user_id: actor.id,
    employee_id: actor.employee_id,
    user_name: actor.full_name,
    action: a.action,
    entity_type: a.entityType,
    entity_id: a.entityId === undefined || a.entityId === null ? null : String(a.entityId),
    entity_name: a.entityName ?? null,
    details: a.details === undefined ? null : JSON.parse(JSON.stringify(a.details)),
    reason: a.reason ?? null,
    ip: actor.ip ?? null,
  };
  const hash = computeHash(prev, row);
  await db.query(
    `INSERT INTO audit_log (ts,user_id,employee_id,user_name,action,entity_type,entity_id,entity_name,details,reason,ip,prev_hash,hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [row.ts, row.user_id, row.employee_id, row.user_name, row.action, row.entity_type, row.entity_id, row.entity_name,
      row.details === null ? null : JSON.stringify(row.details), row.reason, row.ip, prev, hash],
  );
}

export async function audit(actor: Actor, a: AuditInput): Promise<void> {
  await tx((db) => writeAudit(db, actor, a));
}

/** Re-compute the whole hash chain. Returns the first broken record id, if any. */
export async function verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: string }> {
  let prev = GENESIS;
  let checked = 0;
  let lastId = "0";
  for (;;) {
    const rows = await q<AuditRow>("SELECT * FROM audit_log WHERE id > $1 ORDER BY id LIMIT 2000", [lastId]);
    if (!rows.length) break;
    for (const r of rows) {
      const expected = computeHash(prev, r);
      if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, checked, brokenAt: r.id };
      prev = r.hash;
      checked++;
      lastId = r.id;
    }
  }
  return { ok: true, checked };
}
