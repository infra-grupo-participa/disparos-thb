import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { parseBody, KanbanMoverSchema } from "@/lib/validators";
import { moverEstagio } from "@/lib/services/contato";

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
       select h.comprador_id, h.nome, h.email, h.telefone, h.edicao, h.estagio_chave,
              ct.tags, ct.responsavel, ct.opt_out, ct.id as contato_id, h.ultima_resposta_em, ct.atualizado_em,
              row_number() over (partition by h.estagio_chave order by ct.atualizado_em desc nulls last, h.nome) as rk
         from cs.contatos_ht h
         join cs.contatos ct on ct.comprador_id = h.comprador_id
        where ($1::text is null or h.edicao = $1)
          and ($2::text is null or ct.responsavel = $2)
          and ($3::text is null or $3 = any(ct.tags))
     )
     select b.comprador_id, b.nome, b.email, b.telefone, b.edicao, b.estagio_chave, b.tags, b.responsavel, b.opt_out, b.ultima_resposta_em,
            um.descricao as ultima_msg,
            me.criado_em as entrou_estagio_em
       from base b
       left join lateral (
         select i.descricao from cs.interacoes i
          where i.contato_id = b.contato_id
          order by i.criado_em desc limit 1
       ) um on true
       left join lateral (
         select i.criado_em from cs.interacoes i
          where i.contato_id = b.contato_id and i.tipo = 'mudanca_estagio'
          order by i.criado_em desc limit 1
       ) me on true
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
  const p = await parseBody(req, KanbanMoverSchema);
  if (!p.ok) return p.res;
  const ok = await moverEstagio(p.data.compradorId, p.data.estagioChave);
  if (!ok) return NextResponse.json({ ok: false, reason: "estagio_invalido" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
