// Session token helpers. No DB access here so proxy.ts can import it.
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "sv_session";
export const SESSION_HOURS = 8;

export interface SessionClaims {
  uid: number;
  sv: number; // session_version, bumped on password reset / deactivation
  mcp: boolean; // must change password
}

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(secret);
}

export async function signSession(c: SessionClaims): Promise<string> {
  return new SignJWT({ ...c })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function readSession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { uid: Number(payload.uid), sv: Number(payload.sv), mcp: Boolean(payload.mcp) };
  } catch {
    return null;
  }
}
