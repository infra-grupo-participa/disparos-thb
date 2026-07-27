-- =====================================================================
-- 0142_hm_atribuicao_travada
--
-- Trava de atribuição pelo admin principal (decisão do Marcio, 27/07). Quando
-- o admin/GP atribui um chamado a um operador, a atribuição fica IMUTÁVEL para
-- operadores comuns: ninguém que não seja admin/GP pode assumir nem reatribuir
-- aquele card (nem o próprio dono, nem outro operador). Só admin/GP remaneja.
-- O pool (sem dono) segue livre — o operador ainda assume o que está solto.
--
-- `atribuicao_admin` marca que a atribuição vigente veio do admin (portanto
-- travada). Ao devolver ao pool (responsavel_id = null), a trava zera junto —
-- feito na aplicação (setResponsavelHmPorId).
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================
alter table cs.contatos_hm
  add column if not exists atribuicao_admin boolean not null default false;

comment on column cs.contatos_hm.atribuicao_admin is
  'true = a atribuição atual foi feita pelo admin/GP → travada p/ operadores comuns.';
