// Measures Neon round-trip latency and the cost of loading a workbook model. Usage: npm run db:profile
import { pool, q } from "../lib/db";

async function time<T>(label: string, fn: () => Promise<T>) {
  const t = performance.now();
  const r = await fn();
  console.log(`${label.padEnd(42)} ${Math.round(performance.now() - t)} ms`);
  return r;
}

(async () => {
  await time("first query (connect + TLS)", () => q("SELECT 1"));
  for (let i = 0; i < 3; i++) await time(`SELECT 1 (warm #${i + 1})`, () => q("SELECT 1"));
  await time("5 parallel SELECT 1", () => Promise.all([1, 2, 3, 4, 5].map(() => q("SELECT 1"))));
  await time("5 parallel SELECT 1 (warm)", () => Promise.all([1, 2, 3, 4, 5].map(() => q("SELECT 1"))));
  const v = await time("model JSONB of latest version", () => q("SELECT model FROM file_versions ORDER BY id DESC LIMIT 1"));
  console.log("model size KB", Math.round(JSON.stringify(v[0]?.model ?? {}).length / 1024));
  await time("model::text of latest version", () => q("SELECT model::text FROM file_versions ORDER BY id DESC LIMIT 1"));
  await pool().end();
})();
