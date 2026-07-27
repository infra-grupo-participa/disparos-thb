import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, EquipeCriarSchema } from "@/lib/validators";

export const runtime = "nodejs";

// Gestão de equipes do HM — só quem vê tudo (admin ou equipe principal/GP) abre
// esta área. É a config de quem responde por quais canais e quem enxerga o quê.

// GET /api/hm/equipes — equipes + membros (para a aba de config).
export async function GET() {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const equipes = await query(
    `select e.id, e.nome, e.tipo, e.cor, e.ativo,
            coalesce(m.qtd, 0)::int as membros
       from cs.equipes e
       left join (select equipe_id, count(*) as qtd from cs.usuarios where equipe_id is not null group by equipe_id) m
              on m.equipe_id = e.id
      order by (e.tipo = 'principal') desc, e.nome`,
  );
  // Todos os usuários com a equipe atual — para a tela montar "quem é de quem".
  const usuarios = await query(
    `select id, nome, email, papel, ativo, equipe_id, lider_equipe
       from cs.usuarios order by ativo desc, nome`,
  );
  return NextResponse.json({ ok: true, equipes, usuarios });
}

// POST /api/hm/equipes — cria equipe comum (nome + cor). A principal (GP) é única
// e nasce no seed; não se cria outra principal por aqui.
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const p = await parseBody(req, EquipeCriarSchema);
  if (!p.ok) return p.res;

  const nome = p.data.nome.trim();
  const existe = await queryOne(`select 1 from cs.equipes where lower(nome) = lower($1)`, [nome]);
  if (existe) return NextResponse.json({ ok: false, reason: "nome_em_uso" }, { status: 409 });

  const nova = await queryOne<{ id: string }>(
    `insert into cs.equipes (nome, cor, tipo) values ($1, $2, 'comum') returning id`,
    [nome, p.data.cor],
  );
  return NextResponse.json({ ok: true, id: nova?.id });
}
