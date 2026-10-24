// Smoke test: every page returns 200 for a signed-in user. Usage: BASE=... EMP=... PW=... node --import tsx scripts/smoke-pages.ts
const BASE = process.env.BASE ?? "http://localhost:3100";

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ employeeId: process.env.EMP, password: process.env.PW }),
  });
  const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
  const files = await (await fetch(`${BASE}/api/reports`, { headers: { cookie } })).json();
  const fid = files.rows?.[0]?.id ?? 1;
  let bad = 0;
  for (const p of ["/explorer", "/tasks", "/reports", "/audit", "/admin", "/admin?tab=requests", "/admin?tab=bin", `/files/${fid}`, `/files/${fid}/report`, "/change-password", "/login"]) {
    const r = await fetch(BASE + p, { headers: { cookie }, redirect: "manual" });
    const html = await r.text();
    const ok = r.status === 200 || (p === "/login" && r.status === 307);
    if (!ok) bad++;
    console.log(ok ? "PASS" : "FAIL", r.status, p, html.includes("Application error") ? "(application error)" : "");
  }
  process.exit(bad ? 1 : 0);
})();
