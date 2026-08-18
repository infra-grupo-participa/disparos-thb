-- =====================================================================
-- 0306_o_pedido_de_cancelamento_tem_motivo_e_prazo
--
-- ⚠️ APLICADA EM PRODUCAO 18/08/2026 — este arquivo só versiona o que já
-- rodou no banco. Não reaplicar manualmente.
--
-- ── O pedido (Marcio) ───────────────────────────────────────────────────────
-- "Preciso que quando o comercial mover para Solicitou Cancelamento, ele
--  explique o motivo do cancelamento, e o prazo de cancelamento."
--
-- ── Por que "Solicitou Cancelamento" precisa disto (0301) ──────────────────
-- "Solicitou Cancelamento" (hm_solicitou_cancelamento) registra um pedido
-- feito por MENSAGEM ou LIGAÇÃO ao comercial — por definição, sem rastro
-- nenhum na Hotmart. O que o operador escreve na ficha é a ÚNICA fonte que
-- existe desse pedido; não há webhook, não há compra REFUNDED para conferir.
-- Por isso a coluna PRECISA de estrutura, não só de um card na coluna certa.
--
-- Já existiam duas colunas de cancelamento na tabela (mais antigas, de uso
-- geral — Reclamada/Reembolsado):
--   · cancelamento_motivo   (text livre)  — "Pediu reembolso? SIM" sem o
--     porquê não serve a ninguém (comentário original da 0056/0152).
--   · cancelamento_em       (timestamptz) — quando o PEDIDO foi REGISTRADO
--     no sistema (carimbado por moverEstagioHm ao entrar em hm_cancelamento).
--
-- Faltavam duas coisas que o texto livre não dá, porque texto puro não soma
-- em relatório e "quando eu registrei o pedido" não é "quando a pessoa QUER
-- cancelar":
--   · o motivo CATEGORIZADO — lista fechada de opções, para poder contar
--     "quantos cancelaram por financeiro este mês" sem depender de parsear
--     texto livre;
--   · o PRAZO pedido — a DATA em que a pessoa quer que o cancelamento saia,
--     informada pelo operador. NÃO é a garantia de 7 dias da Hotmart (essa
--     já existe fora daqui, no processo da Hotmart) — é o compromisso que o
--     comercial assumiu com o aluno na conversa.
--
-- `cancelamento_motivo` (texto livre) continua existindo e continua sendo
-- escrito — a observação complementa a categoria, não a substitui.
--
-- Aditiva e idempotente (add column if not exists).
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists cancelamento_motivo_tipo text,
  add column if not exists cancelamento_prazo date;

alter table cs.contatos_hm
  drop constraint if exists contatos_hm_cancelamento_motivo_tipo_check;

alter table cs.contatos_hm
  add constraint contatos_hm_cancelamento_motivo_tipo_check
  check (cancelamento_motivo_tipo is null or cancelamento_motivo_tipo in (
    'financeiro', 'expectativa', 'pessoal', 'tempo', 'concorrente', 'arrependimento', 'outro'
  ));

comment on column cs.contatos_hm.cancelamento_motivo_tipo is
  '0306: motivo do pedido de cancelamento, CATEGORIZADO (lista fechada, para relatório — texto puro não soma). Preenchido pelo operador ao mover o card para "Solicitou Cancelamento" (trava de entrada, moverEstagioHm/B1). Convive com cancelamento_motivo (texto livre, a observação que explica o "outro"/os detalhes).';

comment on column cs.contatos_hm.cancelamento_prazo is
  '0306: a DATA em que a pessoa PEDIU para o cancelamento sair, informada pelo operador na conversa (mensagem/ligação). NÃO é a garantia de 7 dias da Hotmart — é o compromisso assumido com o aluno. Opcional: não trava a entrada em "Solicitou Cancelamento" (só o motivo trava).';
