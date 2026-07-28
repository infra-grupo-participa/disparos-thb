import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/visibilidade";

export const runtime = "nodejs";

// GET /api/hm/inbox — fila de conversas do HM. Rota HM PRÓPRIA (não a genérica):
// o HM vive no overlay isolado cs.contatos_hm, com timeline em contato_hm_id e sem
// entrar em cs.contatos_evento. Espelha o comportamento do Seminário: mostra todos
// os cards com telefone (o comercial inicia a conversa), pendentes no topo.
//
// RECORTE POR OPERADOR (segurança no backend): GP/admin veem tudo; operador comum
// vê só o pool (sem dono) + os cards atribuídos a ele. Mesmo predicado do board.
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") || null; // pendente | resolvido
  const disparoId = sp.get("disparo") || null;

  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  // Última mensagem da conversa (do lead ou do CS), pela timeline do overlay HM.
  const LATERAL_ULTIMA = `
       left join lateral (
         select i.descricao, i.criado_em, (i.tipo = 'nota') as de_cs
           from cs.interacoes i
          where i.contato_hm_id = ch.id
            and (i.tipo = 'resposta' or (i.tipo = 'nota' and i.descricao like 'CS respondeu:%'))
          order by i.criado_em desc
          limit 1
       ) um on true`;

  const COLS = `k.comprador_id, k.nome, k.telefone, null::text as edicao,
                k.estagio_chave, k.estagio_nome, ch.ultima_resposta_em, ch.atualizado_em as ultimo_contato_em,
                ch.inbox_status, ch.aguardando_desde, ch.opt_out, k.responsavel, k.tags,
                um.descricao as ultima_msg, um.de_cs as ultima_de_cs, um.criado_em as ultima_msg_em`;

  const conversas = disparoId
    ? // Modo "disparo": quem recebeu aquele disparo (para o link "Ver conversas").
      // $1=disparoId, $2=verTudo, $3=usuarioId, $4=equipeId.
      await query(
        `select ${COLS}
           from cs.disparo_contatos dc
           join cs.contatos_hm_kanban k on k.comprador_id = dc.comprador_id
           join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
           ${LATERAL_ULTIMA}
          where dc.disparo_id = $1 and dc.enviado
            and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel" }, { verTudo: 2, usuario: 3, equipe: 4 })}
          order by dc.enviado_em desc nulls last
          limit 500`,
        [disparoId, verTudo, usuarioId, equipeId],
      )
    : // Fila normal. $1=status, $2=verTudo, $3=usuarioId, $4=equipeId.
      await query(
        `select ${COLS}
           from cs.contatos_hm_kanban k
           join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
           ${LATERAL_ULTIMA}
          where k.telefone is not null and k.telefone <> ''
            and ($1::text is null or ch.inbox_status = $1)
            and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel" }, { verTudo: 2, usuario: 3, equipe: 4 })}
          order by (ch.inbox_status = 'pendente') desc,
                   coalesce(ch.aguardando_desde, ch.ultima_resposta_em, ch.atualizado_em) desc
          limit 200`,
        [status, verTudo, usuarioId, equipeId],
      );

  // Contador de pendentes — mesmo recorte. $1=verTudo, $2=usuarioId, $3=equipeId.
  const resumo = await queryOne<{ pendentes: number }>(
    `select count(*)::int as pendentes
       from cs.contatos_hm_kanban k
       join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
      where ch.inbox_status = 'pendente'
        and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel" }, { verTudo: 1, usuario: 2, equipe: 3 })}`,
    [verTudo, usuarioId, equipeId],
  );

  return NextResponse.json({ ok: true, conversas, pendentes: resumo?.pendentes ?? 0 });
}
