import crypto from "node:crypto";
import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";

export const SESSION_COOKIE = "cs_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

// Papéis e suas capacidades:
//   admin       — acesso total (gestão de usuários + disparos).
//   disparador  — operador que TAMBÉM pode efetuar disparos.
//   operador    — opera Kanban/contatos/inbox, mas NÃO dispara.
export type Papel = "admin" | "disparador" | "operador";
export type Usuario = { id: string; nome: string; email: string; papel: Papel; ativo: boolean };

// Regra única de "pode efetuar disparos" — fonte da verdade compartilhada
// entre o backend (app/api/send) e o gating de UI. Mude aqui e vale em tudo.
export function podeDisparar(papel: Papel | null | undefined): boolean {
  return papel === "admin" || papel === "disparador";
}

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-troque-isto";
}

// ===== Sessão (token sem store) ============================================
// Token: "<userId>.<ts>.<hmac(userId.ts)>". Válido se a assinatura bate e não
// expirou. O userId viaja no token para sabermos quem está logado sem store.
export function makeToken(userId: string): string {
  const ts = Date.now().toString();
  const base = `${userId}.${ts}`;
  const sig = crypto.createHmac("sha256", secret()).update(base).digest("hex");
  return `${base}.${sig}`;
}

// Retorna o userId se o token for válido (assinatura + validade); senão null.
export function verifyToken(token?: string | null): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const base = token.slice(0, i); // "<userId>.<ts>"
  const sig = token.slice(i + 1);
  const j = base.indexOf(".");
  if (j <= 0) return null;
  const userId = base.slice(0, j);
  const ts = Number(base.slice(j + 1));
  if (!userId || !Number.isFinite(ts)) return null;

  const expected = crypto.createHmac("sha256", secret()).update(base).digest("hex");
  const a = new Uint8Array(Buffer.from(sig));
  const b = new Uint8Array(Buffer.from(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - ts >= MAX_AGE_MS) return null;
  return userId;
}

// Presença de sessão válida (não confirma que o usuário ainda existe/está ativo).
export function isAuthed(): boolean {
  return verifyToken(cookies().get(SESSION_COOKIE)?.value) !== null;
}

// Sessão completa: resolve o usuário no banco a partir do token. Retorna null se
// o token é inválido OU o usuário foi removido/desativado. Use quando precisar
// saber quem é / qual o papel (gating de admin, autoria, atribuição).
export async function getSessao(): Promise<Usuario | null> {
  const userId = verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const u = await queryOne<Usuario>(
    `select id, nome, email, papel, ativo from cs.usuarios where id = $1 and ativo = true`,
    [userId],
  );
  return u ?? null;
}

// ===== Senha (scrypt nativo) ===============================================
// Formato armazenado: "scrypt$<saltHex>$<hashHex>". Parâmetros default do
// scrypt (N=16384, r=8, p=1), keylen 64. Comparação em tempo constante.
const SCRYPT_KEYLEN = 64;

export function hashSenha(senha: string): string {
  const salt = new Uint8Array(crypto.randomBytes(16));
  const dk = new Uint8Array(crypto.scryptSync(senha, salt, SCRYPT_KEYLEN));
  return `scrypt$${Buffer.from(salt).toString("hex")}$${Buffer.from(dk).toString("hex")}`;
}

export function verifySenha(senha: string, armazenado: string | null | undefined): boolean {
  if (!armazenado) return false;
  const [algo, saltHex, hashHex] = armazenado.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const salt = new Uint8Array(Buffer.from(saltHex, "hex"));
    const a = new Uint8Array(crypto.scryptSync(senha, salt, SCRYPT_KEYLEN));
    const b = new Uint8Array(Buffer.from(hashHex, "hex"));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
