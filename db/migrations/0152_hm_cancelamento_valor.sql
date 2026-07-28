-- =====================================================================
-- 0152_hm_cancelamento_valor
--
-- Campo FINANCEIRO do pedido de cancelamento (pedido do Victor via Marcio,
-- 28/07): "no card precisa constar um campo a respeito do financeiro para
-- anotar o dia e o porquê do pedido de cancelamento". O dia (cancelamento_em)
-- e o porquê (cancelamento_motivo) já existem; falta o VALOR — quanto será
-- reembolsado/retido no cancelamento.
--
-- Coluna numérica simples em cs.contatos_hm. Exposta ao FINAL da view do kanban.
-- Idempotente.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists cancelamento_valor numeric;

comment on column cs.contatos_hm.cancelamento_valor is
  'Valor financeiro do pedido de cancelamento (a reembolsar/reter), anotado pela equipe. Complementa cancelamento_em (dia) e cancelamento_motivo (porquê).';

-- Expõe cancelamento_valor na view do kanban (ao FINAL — create or replace não
-- reordena/renomeia colunas existentes). Corpo idêntico ao vigente + a coluna nova.
-- (Aplicado no banco via MCP; a definição completa vive no histórico da view.)
