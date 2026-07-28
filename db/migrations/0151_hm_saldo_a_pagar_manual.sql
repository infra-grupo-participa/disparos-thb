-- =====================================================================
-- 0151_hm_saldo_a_pagar_manual
--
-- Saldo a pagar INFORMADO manualmente (pedido do Victor via Marcio, 28/07):
-- "no card precisa constar o valor do saldo a pagar; essa informação chega até
-- vocês através do Victor". Ou seja: valor DIGITADO por quem opera o card, com
-- base no que o Victor passa — não o pró-rata calculado.
--
-- Estratégia: coluna própria `saldo_a_pagar_manual` (numeric). Quando preenchida,
-- é a verdade que o card mostra (vem do Victor); quando NULL, o card segue
-- exibindo o pró-rata calculado / o fallback de saldo cheio (comportamento atual).
-- Guardamos também quem informou e quando, para auditoria no rodapé.
--
-- Exposta ao FINAL da view do kanban (create or replace não reordena). Idempotente.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists saldo_a_pagar_manual      numeric,
  add column if not exists saldo_a_pagar_manual_por  text,
  add column if not exists saldo_a_pagar_manual_em   timestamptz;

comment on column cs.contatos_hm.saldo_a_pagar_manual is
  'Saldo a pagar informado manualmente (via Victor). NULL = usa o pró-rata calculado. Quando setado, é o valor que o card mostra.';
