import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __svPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // pg treats sslmode=require as verify-full already; say so explicitly to silence its warning.
  return url.replace("sslmode=require", "sslmode=verify-full");
}

export function pool(): Pool {
  if (!global.__svPool) {
    global.__svPool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.PG_POOL_MAX ?? 8),
      // Reuse warm TLS connections, but drop them before Neon's ~5 min idle suspend cuts them.
      idleTimeoutMillis: 60_000,
      keepAlive: true,
    });
    // An idle connection killed by the server must not crash the process.
    global.__svPool.on("error", (e) => console.warn("PostgreSQL idle connection closed:", e.message));
  }
  return global.__svPool;
}

export type Db = Pick<PoolClient, "query">;

const CONNECTION_ERRORS = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "57P01", "08006", "08003"]);
const isConnectionError = (e: unknown) =>
  CONNECTION_ERRORS.has((e as { code?: string })?.code ?? "") || /Connection terminated/i.test((e as Error)?.message ?? "");

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T[]> {
  try {
    return (await db.query<T>(text, params)).rows;
  } catch (e) {
    // A single statement outside a transaction is safe to retry once on a fresh connection.
    if (db === global.__svPool && isConnectionError(e)) return (await db.query<T>(text, params)).rows;
    throw e;
  }
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  let client = await pool().connect();
  try {
    await client.query("BEGIN");
  } catch (e) {
    // Stale pooled connection: discard it and start the transaction on a fresh one (nothing ran yet).
    client.release(true);
    if (!isConnectionError(e)) throw e;
    client = await pool().connect();
    await client.query("BEGIN");
  }
  let broken = false;
  try {
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    broken = isConnectionError(e);
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release(broken);
  }
}
