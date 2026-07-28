import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, KanbanMoverSchema } from "@/lib/validators";
import { listaResponsaveis, sqlEscopo } from "@/lib/services/visibilidade";
import { moverEstagio, podeVerContato } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

const MAX_POR_COLUNA = 40; // limita o DOM; o total real vai no header da coluna

// GET /api/kanban?edicao=HT27 — colunas (estágios do evento ativo) + cards.
// Filtra tudo pelo evento (HT/Seminário) do contexto (cookie/querystring).
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const edicao = sp.get("edicao") || null;
  const responsavel = sp.get("responsavel") || null;
  const tag = sp.get("tag") || null;
  const evento = eventoDe(req);
  // Escopo de visibilidade (recorte de SEGURANÇA, 0146): master vê tudo; gestor
  // vê o pool + os cards da equipe dele; operador vê o pool + os dele. O filtro
  // por responsável ($2) é conveniência por cima do recorte, nunca o contrário.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  const f = [edicao, responsavel, tag, evento, verTudo, usuarioId, equipeId];
  const escopo = { verTudo: 5, usuario: 6, equipe: 7 };

  // Filtros ($1 edição, $2 responsável, $3 tag, $4 evento) em colunas e cards.
  // A equipe do card deriva do dono (ru.equipe_id) — cs.contatos cru não a tem.
  const colunas = await query(
    `select e.chave, e.nome, e.cor,
            count(ct.id) filter (
              where ($1::text is null or ct.comprador_id in (select comprador_id from cs.contatos_evento where evento = $4 and edicao = $1))
                and ($2::text is null or ct.responsavel = $2)
                and ($3::text is null or $3 = any(ct.tags))
                and ${sqlEscopo({ rid: "ct.responsavel_id", eq: "ru.equipe_id", nome: "ct.responsavel" }, escopo)}
            )::int as total
       from cs.estagios e
       left join cs.contatos ct on ct.estagio_id = e.id and ct.evento = $4
       left join cs.usuarios ru on ru.id = ct.responsavel_id
      where e.ativo and e.evento = $4
      group by e.id, e.chave, e.nome, e.cor, e.ordem
      order by e.ordem`,
    f,
  );

  const cards = await query(
    `with base as (
       select h.comprador_id, h.nome, h.email, h.telefone, h.edicao, h.estagio_chave,
              ct.tags, ct.responsavel, ct.opt_out, ct.id as contato_id, h.ultima_resposta_em, ct.atualizado_em,
              row_number() over (partition by h.estagio_chave order by ct.atualizado_em desc nulls last, h.nome) as rk
         from cs.contatos_evento h
         join cs.contatos ct on ct.comprador_id = h.comprador_id and ct.evento = h.evento
        where h.evento = $4
          and ($1::text is null or h.edicao = $1)
          and ($2::text is null or ct.responsavel = $2)
          and ($3::text is null or $3 = any(ct.tags))
          and ${sqlEscopo({ rid: "h.responsavel_id", eq: "h.equipe_id", nome: "h.responsavel" }, escopo)}
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

  // Edições ordenadas pela mais RECENTE (por data de criação dos contatos, não
  // alfabética — "JUL" viria depois de "JUN" no alfabeto, mas é mais novo). O
  // front pré-seleciona a primeira, então a edição vigente entra como padrão.
  const edicoesRows = await query<{ edicao: string }>(
    `select ce.edicao
       from cs.contatos_evento ce
       join cs.contatos ct on ct.comprador_id = ce.comprador_id and ct.evento = ce.evento
      where ce.evento = $1 and ce.edicao is not null
      group by ce.edicao
      order by max(ct.criado_em) desc nulls last`,
    [evento],
  );
  // Lista de responsáveis RECORTADA por nível (regra única em
  // listaResponsaveis, visibilidade.ts — a mesma do board HM): master = todos +
  // legados do evento; gestor = a própria equipe; operador = só ele — o seletor
  // não pode oferecer um destino que o backend vai recusar (podeAtribuirPara).
  const responsaveis = await listaResponsaveis(g.sessao, {
    sql: `select distinct responsavel from cs.contatos where evento = $1 and responsavel is not null and responsavel <> ''`,
    params: [evento],
  });
  const tagRows = await query<{ tag: string }>(
    `select distinct unnest(tags) as tag from cs.contatos where evento = $1 and array_length(tags, 1) > 0 order by tag`,
    [evento],
  );

  return NextResponse.json({
    ok: true,
    colunas,
    cards,
    edicoes: edicoesRows.map((e) => e.edicao),
    responsaveis,
    tags: tagRows.map((t) => t.tag),
  });
}

// PATCH /api/kanban — move um card de estágio. body: { compradorId, estagioChave }
export async function PATCH(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const evento = eventoDe(req);
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const p = await parseBody(req, KanbanMoverSchema);
  if (!p.ok) return p.res;
  // Gating de equipe: só move card que o ator VÊ (pool / própria equipe / os
  // dele). Sem isso o recorte do GET é cosmético — bastava forçar o compradorId.
  if (!(await podeVerContato(g.sessao, p.data.compradorId, evento))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  // O MESMO evento validado no guard acima escopa a escrita: cs.contatos tem
  // uma linha por (comprador, evento) — sem ele, o move vazava para outro portal.
  const ok = await moverEstagio(p.data.compradorId, evento, p.data.estagioChave, g.sessao.nome || "cs");
  if (!ok) return NextResponse.json({ ok: false, reason: "estagio_invalido" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
