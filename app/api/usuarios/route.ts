import { NextResponse } from "next/server";
import { getSessao, hashSenha } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, UsuarioCriarSchema } from "@/lib/validators";

export const runtime = "nodejs";

// GET /api/usuarios — lista usuários (sem hash). Qualquer sessão válida pode
// listar: a lista alimenta os seletores de responsável no Kanban/contatos.
export async function GET() {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });

  const usuarios = await query(
    `select u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
            coalesce((select array_agg(up.portal) from cs.usuario_portais up where up.usuario_id = u.id), '{}') as portais
       from cs.usuarios u order by u.ativo desc, u.nome`,
  );
  // podeGerirAcesso (admin + GP) controla a edição de portais na UI.
  return NextResponse.json({
    ok: true, usuarios,
    sou_admin: sessao.papel === "admin",
    pode_gerir_acesso: podeGerirAcesso(sessao.papel, sessao.equipe_tipo),
  });
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
