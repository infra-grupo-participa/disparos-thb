import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/inbox — fila de conversas do evento ativo: leads que já responderam.
// Pendentes (aguardando o CS/comercial) sobem ao topo; ?status filtra a fila.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") || null; // pendente | resolvido
  const disparoId = sp.get("disparo") || null; // ver só os contatos de um disparo
  const evento = eventoDe(req);

  // No HT, a fila do inbox é só quem já respondeu (atendimento reativo). Em
  // eventos de prospecção (ex.: Seminário), o comercial inicia a conversa, então
  // a fila mostra todos os leads com telefone — os que interagiram no topo.
  const todosDoEvento = evento !== "HT";

  const LATERAL_ULTIMA = `
       left join lateral (
         -- Última mensagem da conversa, seja do lead (resposta) ou do CS
         -- (nota "CS respondeu: ...", como o inbox registra ao enviar).
         select i.descricao, i.criado_em, (i.tipo = 'nota') as de_cs
           from cs.interacoes i
          where i.contato_id = ct.id
            and (i.tipo = 'resposta' or (i.tipo = 'nota' and i.descricao like 'CS respondeu:%'))
          order by i.criado_em desc
          limit 1
       ) um on true`;

  // Modo "disparo": lista exatamente quem recebeu aquele disparo, na ordem em
  // que a mensagem saiu (timestamp do envio, mais recente no topo).
  const conversas = disparoId
    ? await query(
        `select v.comprador_id, v.nome, v.telefone, v.edicao,
                v.estagio_chave, v.estagio_nome, v.ultima_resposta_em, v.ultimo_contato_em,
                ct.inbox_status, ct.aguardando_desde, ct.opt_out, ct.responsavel, ct.tags,
                um.descricao as ultima_msg, um.de_cs as ultima_de_cs, um.criado_em as ultima_msg_em
           from cs.disparo_contatos dc
           join cs.contatos_evento v on v.comprador_id = dc.comprador_id and v.evento = $2
           join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
           ${LATERAL_ULTIMA}
          where dc.disparo_id = $1 and dc.enviado
          order by dc.enviado_em desc nulls last
          limit 500`,
        [disparoId, evento],
      )
    : await query(
        `select v.comprador_id, v.nome, v.telefone, v.edicao,
                v.estagio_chave, v.estagio_nome, v.ultima_resposta_em, v.ultimo_contato_em,
                ct.inbox_status, ct.aguardando_desde, ct.opt_out, ct.responsavel, ct.tags,
                um.descricao as ultima_msg, um.de_cs as ultima_de_cs, um.criado_em as ultima_msg_em
           from cs.contatos_evento v
           join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
           ${LATERAL_ULTIMA}
          where v.evento = $2
            and ($3::boolean or v.ultima_resposta_em is not null)
            and (v.telefone is not null and v.telefone <> '')
            and ($1::text is null or ct.inbox_status = $1)
          order by (ct.inbox_status = 'pendente') desc,
                   coalesce(ct.aguardando_desde, v.ultima_resposta_em, v.ultimo_contato_em) desc
          limit 200`,
        [status, evento, todosDoEvento],
      );

  const resumo = await queryOne<{ pendentes: number }>(
    `select count(*) filter (where inbox_status = 'pendente')::int as pendentes from cs.contatos where evento = $1`,
    [evento],
  );

  return NextResponse.json({ ok: true, conversas, pendentes: resumo?.pendentes ?? 0 });
}
