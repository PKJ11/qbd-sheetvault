import "server-only";
import { randomBytes } from "crypto";
import { jwtVerify, SignJWT } from "jose";

/**
 * ONLYOFFICE Docs integration settings.
 *  ONLYOFFICE_URL           address of Document Server as the *browser* sees it (e.g. http://qbd-server:8080)
 *  ONLYOFFICE_INTERNAL_URL  address SheetVault uses to call Document Server (defaults to ONLYOFFICE_URL)
 *  ONLYOFFICE_JWT_SECRET    must equal services.CoAuthoring.secret in Document Server's local.json
 *  APP_INTERNAL_URL         address Document Server uses to reach SheetVault (e.g. http://localhost:3000)
 */
export function onlyofficeSettings() {
  const url = process.env.ONLYOFFICE_URL?.replace(/\/$/, "");
  const secret = process.env.ONLYOFFICE_JWT_SECRET;
  const appUrl = process.env.APP_INTERNAL_URL?.replace(/\/$/, "");
  if (!url || !secret || !appUrl) return null;
  return { url, internalUrl: (process.env.ONLYOFFICE_INTERNAL_URL ?? url).replace(/\/$/, ""), secret, appUrl };
}

export function requireOnlyoffice() {
  const s = onlyofficeSettings();
  if (!s) throw new Error("ONLYOFFICE is not configured (ONLYOFFICE_URL, ONLYOFFICE_JWT_SECRET, APP_INTERNAL_URL).");
  return s;
}

const enc = (s: string) => new TextEncoder().encode(s);

/** Sign a payload for Document Server (editor config, command service). */
export async function signForDocs(payload: Record<string, unknown>, secret: string, expiresIn = "8h") {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt().setExpirationTime(expiresIn).sign(enc(secret));
}

/** Verify a token Document Server sent us (callback body token or Authorization header). */
export async function verifyFromDocs<T>(token: string, secret: string): Promise<T> {
  const { payload } = await jwtVerify(token, enc(secret));
  // The Authorization-header variant wraps the body in { payload: … }.
  return ((payload as { payload?: T }).payload ?? payload) as T;
}

/** Short-lived token authorising Document Server to download one file. Signed with our own AUTH_SECRET. */
export async function fileLinkToken(claims: { fileId: number; version?: number; session?: number }) {
  return new SignJWT({ ...claims, purpose: "oo-file" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(enc(process.env.AUTH_SECRET!));
}

export async function readFileLinkToken(token: string) {
  const { payload } = await jwtVerify(token, enc(process.env.AUTH_SECRET!));
  if (payload.purpose !== "oo-file") throw new Error("wrong token purpose");
  return payload as unknown as { fileId: number; version?: number; session?: number };
}

/** Document keys: max 128 chars of [0-9a-zA-Z.=_-]; a new key tells Document Server the file changed. */
export function newDocKey(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`.replace(/[^0-9a-zA-Z.=_-]/g, "_").slice(0, 128);
}

/** Ask Document Server to save the currently open document now (it then calls our callback with status 6). */
export async function commandForcesave(key: string): Promise<number> {
  const s = requireOnlyoffice();
  const body = { c: "forcesave", key };
  const res = await fetch(`${s.internalUrl}/coauthoring/CommandService.ashx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, token: await signForDocs(body, s.secret, "5m") }),
  });
  const json = (await res.json().catch(() => ({ error: -1 }))) as { error: number };
  // 0 = command accepted, 4 = no changes since the last save, 1 = unknown key (editor closed)
  return json.error;
}
