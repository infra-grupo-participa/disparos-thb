import { NextResponse } from "next/server";
import { hashSenha } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { ehMaster } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, UsuarioCriarSchema } from "@/lib/validators";

export const runtime = "nodejs";

// GET /api/usuarios — lista usuários. Qualquer sessão válida pode listar o
// MÍNIMO (id + nome dos ativos): a lista alimenta os seletores de responsável no
// Kanban/contatos. O payload COMPLETO (e-mail, papel, portais, inativos) só sai
// para o master — é dado de gestão de conta, não de seletor.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  if (!ehMaster(sessao)) {
    const usuarios = await query(
      `select u.id, u.nome, u.ativo from cs.usuarios u where u.ativo order by u.nome`,
    );
    return NextResponse.json({ ok: true, usuarios, sou_admin: false, pode_gerir_acesso: false });
  }

  // equipe_id/equipe_tipo/lider_equipe entram no payload de master para o
  // SeloNivel da tela de Contas calcular o nível efetivo via lib/papeis.nivelDe
  // (sem eles o selo degrada para "nível ?"). O payload MÍNIMO de não-master
  // acima segue sem esses campos DE PROPÓSITO — só alimenta seletores de
  // responsável e não deve crescer.
  const usuarios = await query(
    `select u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
            u.equipe_id, e.tipo as equipe_tipo, u.lider_equipe,
            coalesce((select array_agg(up.portal) from cs.usuario_portais up where up.usuario_id = u.id), '{}') as portais
       from cs.usuarios u
       left join cs.equipes e on e.id = u.equipe_id
      order by u.ativo desc, u.nome`,
  );
  // pode_gerir_acesso (= master) controla a edição de portais na UI.
  return NextResponse.json({ ok: true, usuarios, sou_admin: true, pode_gerir_acesso: true });
}

// POST /api/usuarios — cria um usuário. Só o master (admin do Grupo Participa).
export async function POST(req: Request) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;

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
