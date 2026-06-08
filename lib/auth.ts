import crypto from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "cs_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-troque-isto";
}

// Token sem store no servidor: "<ts>.<hmac(ts)>". Válido se a assinatura bate e não expirou.
export function makeToken(): string {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", secret()).update(ts).digest("hex");
  return `${ts}.${sig}`;
}

export function verifyToken(token?: string | null): boolean {
  if (!token) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(ts).digest("hex");
  const a = new Uint8Array(Buffer.from(sig));
  const b = new Uint8Array(Buffer.from(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Date.now() - Number(ts) < MAX_AGE_MS;
}

// Para uso em Server Components / Route Handlers (runtime Node).
export function isAuthed(): boolean {
  return verifyToken(cookies().get(SESSION_COOKIE)?.value);
}
