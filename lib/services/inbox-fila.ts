import { query, queryOne } from "@/lib/db";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { sqlEscopo } from "@/lib/services/visibilidade";
import type { Usuario } from "@/lib/auth";

// Fila do inbox — fonte ÚNICA usada por GET /api/inbox, GET /api/hm/inbox e
// POST /api/inbox/sync (que devolve a fila junto, para o cliente fazer UMA
// chamada por tick em vez de sync+fila).
//
// CONTRATO da linha de conversa (o que o cliente recebe — enxuto de propósito;
// este payload sai ~200 linhas × 1 poll a cada ~12s × operador):
//   comprador_id, nome, telefone, edicao, estagio_nome, ultima_resposta_em,
//   inbox_status, aguardando_desde, opt_out, responsavel,
//   ultima_msg, ultima_de_cs, ultima_msg_em
// Removidos (a tela não lê; `tags` é array e multiplicava o payload):
//   estagio_chave, ultimo_contato_em, tags. `responsavel` FICA (uso previsto).
//
// ORDENAÇÃO (fila normal): pendentes primeiro, e ENTRE os pendentes quem espera
// há MAIS tempo no topo (asc) — é uma fila de atendimento, o SLA estoura no mais
// antigo. Os não-pendentes seguem por atividade mais recente (desc), então a aba
// "resolvido" continua mostrando o que acabou de ser resolvido no topo.
//
// O LEFT JOIN LATERAL sobre cs.interacoes (última mensagem da conversa) é
// suportado pelos índices parciais da 0148 (cs_interacoes_ultima_conversa_*):
// 1 index scan curto por linha, em vez de varrer a timeline inteira do contato.

export type FilaFiltro = { status?: string | null; disparoId?: string | null; produto?: "HM" | "AURUM" | "ETHB" };
export type FilaResultado = { conversas: unknown[]; pendentes: number };

// ---- Portais genéricos (HT / SEM / CNHF) — cs.contatos via cs.contatos_evento
export async function filaInbox(sessao: Usuario, evento: string, filtro: FilaFiltro): Promise<FilaResultado> {
  const status = filtro.status ?? null;
  const disparoId = filtro.disparoId ?? null;

  // No HT, a fila é só quem já respondeu (atendimento reativo). Em eventos de
  // prospecção (SEM/CNHF), o comercial inicia a conversa: todos com telefone.
  const todosDoEvento = evento !== "HT";

  // Recorte de SEGURANÇA (0146): fila, modo disparo e contador só mostram o
  // escopo de quem olha (pool/equipe/os dele). Não relaxar por performance.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));
  const ESCOPO_V = (p: { verTudo: number; usuario: number; equipe: number }) =>
    sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, p);

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

  const COLS = `v.comprador_id, v.nome, v.telefone, v.edicao,
                v.estagio_nome, v.ultima_resposta_em,
                ct.inbox_status, ct.aguardando_desde, ct.opt_out, ct.responsavel,
                um.descricao as ultima_msg, um.de_cs as ultima_de_cs, um.criado_em as ultima_msg_em`;

  // Modo "disparo": lista exatamente quem recebeu aquele disparo, na ordem em
  // que a mensagem saiu (timestamp do envio, mais recente no topo).
  const conversas = disparoId
    ? await query(
        `select ${COLS}
           from cs.disparo_contatos dc
           join cs.contatos_evento v on v.comprador_id = dc.comprador_id and v.evento = $2
           join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
           ${LATERAL_ULTIMA}
          where dc.disparo_id = $1 and dc.enviado
            and ${ESCOPO_V({ verTudo: 3, usuario: 4, equipe: 5 })}
          order by dc.enviado_em desc nulls last
          limit 500`,
        [disparoId, evento, verTudo, usuarioId, equipeId],
      )
    : await query(
        `select ${COLS}
           from cs.contatos_evento v
           join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
           ${LATERAL_ULTIMA}
          where v.evento = $2
            and ($3::boolean or v.ultima_resposta_em is not null)
            and (v.telefone is not null and v.telefone <> '')
            and ($1::text is null or ct.inbox_status = $1)
            and ${ESCOPO_V({ verTudo: 4, usuario: 5, equipe: 6 })}
          order by (ct.inbox_status = 'pendente') desc,
                   case when ct.inbox_status = 'pendente'
                        then coalesce(ct.aguardando_desde, v.ultima_resposta_em, v.ultimo_contato_em)
                   end asc nulls last,
                   coalesce(ct.aguardando_desde, v.ultima_resposta_em, v.ultimo_contato_em) desc
          limit 200`,
        [status, evento, todosDoEvento, verTudo, usuarioId, equipeId],
      );

  // O contador espelha o recorte da fila — um "3 pendentes" com fila vazia
  // seria o painel dizendo que existe trabalho que o operador não pode ver.
  // Índice: cs_contatos_evento_pendente_idx (0148).
  const resumo = await queryOne<{ pendentes: number }>(
    `select count(*) filter (where ct.inbox_status = 'pendente')::int as pendentes
       from cs.contatos ct
       left join cs.usuarios ru on ru.id = ct.responsavel_id
      where ct.evento = $1
        and ${sqlEscopo({ rid: "ct.responsavel_id", eq: "ru.equipe_id", nome: "ct.responsavel" }, { verTudo: 2, usuario: 3, equipe: 4 })}`,
    [evento, verTudo, usuarioId, equipeId],
  );

  return { conversas, pendentes: resumo?.pendentes ?? 0 };
}

// ---- HM — overlay isolado (cs.contatos_hm + cs.contatos_hm_kanban) ---------
// Mesmo contrato de linha e mesma ordenação da fila genérica (a tela é a MESMA,
// app/[portal]/inbox/page.tsx com inboxBase trocado).
export async function filaInboxHm(sessao: Usuario, filtro: FilaFiltro): Promise<FilaResultado> {
  const status = filtro.status ?? null;
  const disparoId = filtro.disparoId ?? null;
  const produto = filtro.produto ?? "HM"; // board do produto (0155)

  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));

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
                k.estagio_nome, ch.ultima_resposta_em,
                ch.inbox_status, ch.aguardando_desde, ch.opt_out, k.responsavel,
                um.descricao as ultima_msg, um.de_cs as ultima_de_cs, um.criado_em as ultima_msg_em`;

  const conversas = disparoId
    ? // Modo "disparo": quem recebeu aquele disparo (link "Ver conversas").
      await query(
        `select ${COLS}
           from cs.disparo_contatos dc
           join cs.contatos_hm_kanban k on k.comprador_id = dc.comprador_id
           join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
           ${LATERAL_ULTIMA}
          where dc.disparo_id = $1 and dc.enviado
            and ch.produto = $5
            -- poolRestrito (0265): mesma regra do board HM — card livre não
            -- é mais pool visível a todos.
            and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel" }, { verTudo: 2, usuario: 3, equipe: 4 }, { poolRestrito: true })}
          order by dc.enviado_em desc nulls last
          limit 500`,
        [disparoId, verTudo, usuarioId, equipeId, produto],
      )
    : await query(
        `select ${COLS}
           from cs.contatos_hm_kanban k
           join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
           ${LATERAL_ULTIMA}
          where k.telefone is not null and k.telefone <> ''
            and ($1::text is null or ch.inbox_status = $1)
            and ch.produto = $5
            and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel" }, { verTudo: 2, usuario: 3, equipe: 4 }, { poolRestrito: true })}
          order by (ch.inbox_status = 'pendente') desc,
                   case when ch.inbox_status = 'pendente'
                        then coalesce(ch.aguardando_desde, ch.ultima_resposta_em, ch.atualizado_em)
                   end asc nulls last,
                   coalesce(ch.aguardando_desde, ch.ultima_resposta_em, ch.atualizado_em) desc
          limit 200`,
        [status, verTudo, usuarioId, equipeId, produto],
      );

  const resumo = await queryOne<{ pendentes: number }>(
    `select count(*)::int as pendentes
       from cs.contatos_hm_kanban k
       join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
      where ch.inbox_status = 'pendente'
        and ch.produto = $4
        and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel" }, { verTudo: 1, usuario: 2, equipe: 3 }, { poolRestrito: true })}`,
    [verTudo, usuarioId, equipeId, produto],
  );

  return { conversas, pendentes: resumo?.pendentes ?? 0 };
}
