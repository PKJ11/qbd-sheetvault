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
      // Opening a TLS connection to Neon costs several round trips; keep idle connections around.
      idleTimeoutMillis: 5 * 60_000,
      keepAlive: true,
    });
  }
  return global.__svPool;
}

export type Db = Pick<PoolClient, "query">;

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T[]> {
  const r = await db.query<T>(text, params);
  return r.rows;
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
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
