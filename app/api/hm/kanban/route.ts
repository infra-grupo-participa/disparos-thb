import { NextResponse } from "next/server";
import { isAuthed, getSessao } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseBody, HmMoverSchema } from "@/lib/validators";
import { moverEstagioHm } from "@/lib/services/hm";

export const runtime = "nodejs";

// GET /api/hm/kanban — colunas (estágios HM, com a aba) + cards do overlay
// cs.contatos_hm. Sem edição/evento: o HM é um espaço próprio (turma T39).
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const responsavel = sp.get("responsavel") || null;
  const tag = sp.get("tag") || null;
  const f = [responsavel, tag];

  const colunas = await query(
    `select e.chave, e.nome, e.cor, e.aba,
            count(k.contato_hm_id) filter (
              where ($1::text is null or k.responsavel = $1)
                and ($2::text is null or $2 = any(k.tags))
            )::int as total
       from cs.estagios e
       left join cs.contatos_hm_kanban k on k.estagio_chave = e.chave
      where e.ativo and e.evento = 'HM'
      group by e.id, e.chave, e.nome, e.cor, e.aba, e.ordem
      order by e.ordem`,
    f,
  );

  const cards = await query(
    `select k.comprador_id, k.nome, k.email, k.telefone, k.turma, k.plano, k.categoria_entrada,
            k.estagio_chave, k.estagio_aba, k.responsavel, k.tags, k.apto_ativacao,
            k.reuniao_em, k.entrevista_em, k.pagamento_em,
            um.descricao as ultima_msg,
            me.criado_em as entrou_estagio_em
       from cs.contatos_hm_kanban k
       left join lateral (
         select i.descricao from cs.interacoes i
          where i.contato_hm_id = k.contato_hm_id
          order by i.criado_em desc limit 1
       ) um on true
       left join lateral (
         select i.criado_em from cs.interacoes i
          where i.contato_hm_id = k.contato_hm_id and i.tipo = 'mudanca_estagio'
          order by i.criado_em desc limit 1
       ) me on true
      where ($1::text is null or k.responsavel = $1)
        and ($2::text is null or $2 = any(k.tags))
      order by k.atualizado_em desc nulls last, k.nome`,
    f,
  );

  const respRows = await query<{ responsavel: string }>(
    `select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> '' order by responsavel`,
  );
  const tagRows = await query<{ tag: string }>(
    `select distinct unnest(tags) as tag from cs.contatos_hm where array_length(tags, 1) > 0 order by tag`,
  );

  return NextResponse.json({
    ok: true,
    colunas,
    cards,
    responsaveis: respRows.map((r) => r.responsavel),
    tags: tagRows.map((t) => t.tag),
  });
}

// PATCH /api/hm/kanban — move um card. body: { compradorId, estagioChave }
export async function PATCH(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const p = await parseBody(req, HmMoverSchema);
  if (!p.ok) return p.res;
  const ok = await moverEstagioHm(p.data.compradorId, p.data.estagioChave, sessao.nome || "cs");
  if (!ok) return NextResponse.json({ ok: false, reason: "estagio_invalido" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
