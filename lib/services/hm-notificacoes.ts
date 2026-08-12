import { query } from "@/lib/db";
import { paramsEscopo, ESTEIRA_COMPARTILHADA_PRODUTO, type EscopoVisibilidade } from "@/lib/papeis";
import { sqlEscopo } from "@/lib/services/visibilidade";

// Notificações de automação (F2): o que o SISTEMA fez sozinho na esteira HM —
// webhook da Hotmart, Make, movimentação automática de card — sem depender de
// um humano ter escrito a nota. "O que aconteceu enquanto eu não estava
// olhando" é exatamente a trilha que já existe em cs.interacoes (a mesma que
// alimenta a atividade por colaborador, lib/services/hm-atividade.ts), só que
// aqui o filtro é o INVERSO: autor É um dos atores automáticos, não os exclui.
//
// Sem migration: nenhuma tabela nova. "Lido"/"não lido" fica no CLIENTE
// (localStorage) — o service não grava nada, só lê.
// ⚠️ Esta lista é o INVERSO de ATORES_SISTEMA (lib/services/hm-atividade.ts) e as
// duas TÊM de andar juntas: autor que falta aqui vira "operador humano" na
// atividade, e autor que falta lá some do sino. `respondi` (gravado por
// app/api/hm/formularios/route.ts e por 0029_fn_respondi_hm_form.sql) estava
// fora das DUAS — aparecia como colaborador fantasma no relatório e sua ação
// não chegava ao sino. Ao acrescentar ator novo, mexer nos dois arquivos.
const ATORES_AUTOMATICOS = ["sistema", "make", "hotmart", "lead", "cs", "respondi"];

export type NotificacaoHm = {
  id: string;
  descricao: string | null;
  autor: string;
  criado_em: string;
  comprador_id: string;
  // ⚠️ `card_nome`, não `nome`: é a chave que o componente do sino lê
  // (app/hm/_components/hm-notificacoes.tsx). Chave com nome diferente dos dois
  // lados compila sem erro nos dois e chega `undefined` no cliente — a mesma
  // classe de bug que já custou 4 ocorrências neste repo. Achado do pentester.
  card_nome: string | null;    // nome do aluno/lead — dá contexto sem abrir a ficha
  // ⚠️ Mesma doença do card_nome acima: o componente do sino (hm-notificacoes.tsx)
  // já declarava `produto` no tipo antes deste select trazer a coluna — hoje
  // inócuo porque o fallback "HM" do componente acerta na prática (produto
  // dominante), mas é o MESMO padrão que perdeu a descrição da tag: campo que
  // existe de um lado e não do outro só não estourou ainda por sorte de dado.
  produto: string | null;
};

// Teto DURO de linhas — nunca full-table. 50 é generoso para "o que aconteceu
// recentemente" (um feed de notificação não precisa de histórico fundo; quem
// quer isso abre a ficha/timeline do card). O chamador pode pedir menos, nunca
// mais — Math.min em vez de aceitar o número cru do cliente.
const LIMITE_MAXIMO = 50;
const LIMITE_PADRAO = 20;

// ⚠️ RECORTE DE VISIBILIDADE OBRIGATÓRIO: mesma regra de qualquer listagem HM
// (lib/services/visibilidade.ts) — sem ela, o operador veria a movimentação
// automática de um card que a ficha dele recusa abrir (vazamento de dado por
// um caminho lateral). O escopo é resolvido pelo CHAMADOR (rota) a partir da
// sessão — este service não sabe quem está perguntando, só filtra.
//
// A view cs.contatos_hm_kanban resolveria responsavel_id/equipe_id pronto, mas
// ela carrega LATERAL JOINs caros (hm_pagamentos, compras — medido: 574ms/19395
// buffers num teste com produto+autor+limit 30) que este feed não precisa.
// Aqui replica-se só o trecho da view que decide a EQUIPE do card
// (COALESCE: usuário responsável → equipe padrão do card → rota por tag/canal
// em cs.equipe_canais) — mesma regra, sem o custo dos joins financeiros.
// Medido o equivalente com EXPLAIN ANALYZE: ~32ms/5428 buffers.
// ⚠️ `abas` NÃO é opcional por conveniência — é a 6ª ponta da armadilha das
// flags de permissão. O feed que omite o ramo não vaza (fail-closed), mas fica
// MAIS RESTRITO que o kanban: quem tem função no HM (cs.usuario_funcoes, 0210)
// vê o card de outra equipe no board e NÃO veria a movimentação automática
// dele no sino — exatamente o card que a função existe para tornar visível.
// Achado do security-pentester nesta leva. O chamador resolve com
// abasDaEsteira() e passa aqui, igual /api/hm/kanban faz.
export async function notificacoesHm(
  escopo: EscopoVisibilidade,
  f: { produto?: string | null; limit?: number; abas?: string[] } = {},
): Promise<NotificacaoHm[]> {
  const produto = f.produto || null;
  const limite = Math.min(Math.max(1, f.limit ?? LIMITE_PADRAO), LIMITE_MAXIMO);
  const abas = f.abas ?? [];
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopo);

  return query<NotificacaoHm>(
    `select i.id, i.descricao, i.autor, i.criado_em,
            ch.comprador_id, cmp.nome as card_nome, ch.produto
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
       join public.compradores cmp on cmp.id = ch.comprador_id
       -- est.aba (abaixo) é consumido pelo recorte de visibilidade
       -- (sqlEscopo) — NÃO remover este join mesmo sem coluna própria no
       -- SELECT: é o que decide se o card entra pelo ramo da esteira
       -- compartilhada (0202).
       left join cs.estagios est on est.id = ch.estagio_id
       -- Mesma cadeia de resolução de equipe da view contatos_hm_kanban
       -- (ver comentário acima): usuário responsável → equipe padrão do card
       -- → rota por canal/tag. Precisa casar EXATO, senão este feed mostra
       -- (ou esconde) card que a listagem principal decide diferente.
       left join cs.usuarios ru on ru.id = ch.responsavel_id
       left join cs.equipes peq on peq.id = ch.equipe_padrao_id
       left join lateral (
         select ec.equipe_id from cs.equipe_canais ec
          where ec.canal = any(ch.tags) limit 1
       ) rota on true
      where i.contato_hm_id is not null
        and lower(btrim(i.autor)) = any($1::text[])
        and ($2::text is null or ch.produto = $2)
        -- aba/produto do CARD + os placeholders abas/produto: os QUATRO juntos,
        -- ou o ramo da esteira compartilhada não é emitido (visibilidade.ts).
        -- est.aba é o mesmo estagio_aba que o kanban passa como k.estagio_aba.
        and ${sqlEscopo(
          {
            rid: "ch.responsavel_id",
            eq: "coalesce(ru.equipe_id, peq.id, rota.equipe_id)",
            nome: "ch.responsavel",
            tags: "ch.tags",
            aba: "est.aba",
            produto: "ch.produto",
          },
          { verTudo: 3, usuario: 4, equipe: 5, abas: 7, produto: 8 },
        )}
      order by i.criado_em desc
      limit $6`,
    [ATORES_AUTOMATICOS, produto, verTudo, usuarioId, equipeId, limite, abas, ESTEIRA_COMPARTILHADA_PRODUTO],
  );
}
