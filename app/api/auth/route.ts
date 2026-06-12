import { NextResponse } from "next/server";
import { makeToken, verifySenha, SESSION_COOKIE } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { parseBody, AuthSchema } from "@/lib/validators";

export const runtime = "nodejs";

type Row = { id: string; senha_hash: string; ativo: boolean };

export async function POST(req: Request) {
  const p = await parseBody(req, AuthSchema);
  if (!p.ok) return p.res;

  const email = p.data.email.trim().toLowerCase();
  const u = await queryOne<Row>(
    `select id, senha_hash, ativo from cs.usuarios where lower(email) = $1`,
    [email],
  );

  // Mesma resposta para "não existe", "inativo" e "senha errada" (não vaza qual).
  if (!u || !u.ativo || !verifySenha(p.data.senha, u.senha_hash)) {
    return NextResponse.json({ ok: false, reason: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, makeToken(u.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
