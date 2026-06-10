import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

const MAX_POR_COLUNA = 40; // limita o DOM; o total real vai no header da coluna

// GET /api/kanban?edicao=HT27 — colunas (estágios da jornada) + cards (compradores).
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const edicao = sp.get("edicao") || null;
  const responsavel = sp.get("responsavel") || null;
  const tag = sp.get("tag") || null;
  const f = [edicao, responsavel, tag];

  // Filtros ($1 edição, $2 responsável, $3 tag) aplicados em colunas e cards.
  const colunas = await query(
    `select e.chave, e.nome, e.cor,
            count(ct.id) filter (
              where ($1::text is null or ct.comprador_id in (select comprador_id from cs.contatos_ht where edicao = $1))
                and ($2::text is null or ct.responsavel = $2)
                and ($3::text is null or $3 = any(ct.tags))
            )::int as total
       from cs.estagios e
       left join cs.contatos ct on ct.estagio_id = e.id
      where e.ativo
      group by e.id, e.chave, e.nome, e.cor, e.ordem
      order by e.ordem`,
    f,
  );

  const cards = await query(
    `with base as (
       select h.comprador_id, h.nome, h.telefone, h.edicao, h.estagio_chave,
              ct.tags, ct.responsavel, ct.opt_out, ct.id as contato_id, h.ultima_resposta_em, ct.atualizado_em,
              row_number() over (partition by h.estagio_chave order by ct.atualizado_em desc nulls last, h.nome) as rk
         from cs.contatos_ht h
         join cs.contatos ct on ct.comprador_id = h.comprador_id
        where ($1::text is null or h.edicao = $1)
          and ($2::text is null or ct.responsavel = $2)
          and ($3::text is null or $3 = any(ct.tags))
     )
     select b.comprador_id, b.nome, b.telefone, b.edicao, b.estagio_chave, b.tags, b.responsavel, b.opt_out, b.ultima_resposta_em,
            um.descricao as ultima_msg
       from base b
       left join lateral (
         select i.descricao from cs.interacoes i
          where i.contato_id = b.contato_id
          order by i.criado_em desc limit 1
       ) um on true
      where b.rk <= ${MAX_POR_COLUNA}
      order by b.estagio_chave, b.rk`,
    f,
  );

  const edicoesRows = await query<{ edicao: string }>(
    `select distinct edicao from cs.contatos_ht where edicao is not null order by edicao desc`,
  );
  const respRows = await query<{ responsavel: string }>(
    `select distinct responsavel from cs.contatos where responsavel is not null and responsavel <> '' order by responsavel`,
  );
  const tagRows = await query<{ tag: string }>(
    `select distinct unnest(tags) as tag from cs.contatos where array_length(tags, 1) > 0 order by tag`,
  );

  return NextResponse.json({
    ok: true,
    colunas,
    cards,
    edicoes: edicoesRows.map((e) => e.edicao),
    responsaveis: respRows.map((r) => r.responsavel),
    tags: tagRows.map((t) => t.tag),
  });
}

// PATCH /api/kanban — move um card de estágio. body: { compradorId, estagioChave }
export async function PATCH(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { compradorId?: string; estagioChave?: string };
  if (!body.compradorId || !body.estagioChave) {
    return NextResponse.json({ ok: false, reason: "dados_incompletos" }, { status: 400 });
  }

  const estagio = await queryOne<{ id: number }>(
    `select id from cs.estagios where chave = $1 and ativo`,
    [body.estagioChave],
  );
  if (!estagio) return NextResponse.json({ ok: false, reason: "estagio_invalido" }, { status: 400 });

  await query(
    `update cs.contatos set estagio_id = $2, atualizado_em = now() where comprador_id = $1`,
    [body.compradorId, estagio.id],
  );
  // Registra a movimentação na timeline.
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'mudanca_estagio', $2, 'cs' from cs.contatos where comprador_id = $1`,
    [body.compradorId, `Movido para "${body.estagioChave}"`],
  );

  return NextResponse.json({ ok: true });
}
