import { NextResponse } from "next/server";
import { getSessao, hashSenha } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { parseBody, UsuarioCriarSchema } from "@/lib/validators";

export const runtime = "nodejs";

// GET /api/usuarios — lista usuários (sem hash). Qualquer sessão válida pode
// listar: a lista alimenta os seletores de responsável no Kanban/contatos.
export async function GET() {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });

  const usuarios = await query(
    `select id, nome, email, papel, ativo, criado_em
       from cs.usuarios order by ativo desc, nome`,
  );
  return NextResponse.json({ ok: true, usuarios, sou_admin: sessao.papel === "admin" });
}

// POST /api/usuarios — cria um usuário (somente admin).
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const p = await parseBody(req, UsuarioCriarSchema);
  if (!p.ok) return p.res;

  const email = p.data.email.trim().toLowerCase();
  const existe = await queryOne(`select 1 from cs.usuarios where lower(email) = $1`, [email]);
  if (existe) return NextResponse.json({ ok: false, reason: "email_em_uso" }, { status: 409 });

  const novo = await queryOne<{ id: string }>(
    `insert into cs.usuarios (nome, email, senha_hash, papel)
     values ($1, $2, $3, $4) returning id`,
    [p.data.nome.trim(), email, hashSenha(p.data.senha), p.data.papel],
  );
  return NextResponse.json({ ok: true, id: novo?.id });
}
