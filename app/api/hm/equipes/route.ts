import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { ehMaster } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, EquipeCriarSchema } from "@/lib/validators";

export const runtime = "nodejs";

// Gestão de equipes do HM. Escrita (criar/editar/excluir/rotas/composição) é do
// master; a LEITURA aceita gestor — a tela dá a ele uma visão read-only da
// PRÓPRIA equipe, e o servidor recorta aqui (a UI filtrar sozinha seria
// defensivo, não segurança).

// GET /api/hm/equipes — equipes + membros (para a aba de config).
// Master: todas as equipes + todos os usuários. Gestor: SÓ a equipe dele e os
// membros dela (gestor sem equipe recebe listas vazias — nada para ver).
export async function GET() {
  const g = await guard({ portal: "HM", nivel: "gestor" });
  if (!g.ok) return g.res;
  const master = ehMaster(g.sessao);
  const equipeId = master ? null : g.sessao.equipe_id;

  const equipes = await query(
    `select e.id, e.nome, e.tipo, e.cor, e.ativo,
            coalesce(m.qtd, 0)::int as membros
       from cs.equipes e
       left join (select equipe_id, count(*) as qtd from cs.usuarios where equipe_id is not null group by equipe_id) m
              on m.equipe_id = e.id
      where $1::boolean or e.id = $2::uuid
      order by (e.tipo = 'principal') desc, e.nome`,
    [master, equipeId],
  );
  // Usuários com a equipe atual — para a tela montar "quem é de quem". Para o
  // gestor, só os da equipe dele: a lista completa exporia nome/e-mail/papel de
  // toda a operação a qualquer líder de equipe comum.
  const usuarios = await query(
    `select id, nome, email, papel, ativo, equipe_id, lider_equipe
       from cs.usuarios
      where $1::boolean or equipe_id = $2::uuid
      order by ativo desc, nome`,
    [master, equipeId],
  );
  return NextResponse.json({ ok: true, equipes, usuarios });
}

// POST /api/hm/equipes — cria equipe comum (nome + cor). A principal (GP) é única
// e nasce no seed; não se cria outra principal por aqui.
export async function POST(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
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
