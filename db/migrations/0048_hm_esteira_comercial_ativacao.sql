-- =====================================================================
-- 0048_hm_esteira_comercial_ativacao
-- Redesenha as DUAS esteiras do HM conforme a operação do comercial/ativação.
--
-- Comercial (o card nasce aqui ao pagar o sinal de R$300 — oferta z391kxd9):
--   Contato Inicial → Reunião Agendada → Reunião Finalizada
--   → Pagamento Realizado → Solicitou Cancelamento
--
-- Ativação (o card entra aqui quando o saldo de R$14.700 é quitado):
--   Pendente de Liberação → Acesso Liberado → Contato Inicial
--   → Entrevista Agendada → Entrevista Finalizada (final)
--
-- Mudanças em relação à 0042:
--  1) 'hm_comprou' passa a se chamar "Contato Inicial". A CHAVE não muda de
--     propósito: ela é referenciada pelo gatilho de venda (fn_seed_contato_hm)
--     e por todo o histórico de cs.interacoes. O que mudou foi a leitura da
--     coluna — ela não é "quem comprou", é "quem o comercial ainda precisa
--     abordar". O card cair aqui sozinho ao pagar o sinal continua igual.
--  2) NOVA 'hm_cancelamento' ("Solicitou Cancelamento") — o CSV de controle
--     rastreia isso ("Pediu reembolso?" / "Pediu o cancelamento") e hoje não
--     havia coluna para o caso. Fica no fim do Comercial.
--  3) NOVA 'hm_ativacao_contato' ("Contato Inicial" da Ativação) — a abordagem
--     do time de ativação depois que o acesso já está liberado, antes de marcar
--     a entrevista.
--  4) 'hm_apto_ativacao' é DESATIVADA. A triagem que ela representava virou a
--     própria "Pendente de Liberação" (0042) e a esteira nova não tem lugar
--     para ela. Os cards que estavam lá voltam para "Pendente de Liberação" —
--     o ponto conservador: ninguém perde acesso, e quem já tinha sido liberado
--     de fato estaria em "Acesso Liberado", não aqui.
--
-- O espelhamento do card pago (aparecer no Comercial em "Pagamento Realizado"
-- E na Ativação ao mesmo tempo) é decidido na apresentação, a partir da aba do
-- estágio real — não há estado duplicado no banco. Ver app/hm/kanban/page.tsx.
--
-- Aditiva e idempotente.
-- =====================================================================

-- 1) Comercial ---------------------------------------------------------------
update cs.estagios set nome = 'Contato Inicial', ordem = 10
 where evento = 'HM' and chave = 'hm_comprou';
update cs.estagios set ordem = 20 where evento = 'HM' and chave = 'hm_reuniao_agendada';
update cs.estagios set ordem = 30 where evento = 'HM' and chave = 'hm_reuniao_finalizada';
update cs.estagios set ordem = 40 where evento = 'HM' and chave = 'hm_pagamento_realizado';

insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba) values
  ('hm_cancelamento', 'Solicitou Cancelamento', 50, '#e11d48', false, false, true, 'HM', 'comercial')
on conflict (chave) do update set
  nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
  is_inicial = excluded.is_inicial, is_final = excluded.is_final, ativo = true,
  evento = excluded.evento, aba = excluded.aba;

-- 2) Ativação ----------------------------------------------------------------
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba) values
  ('hm_ativacao_contato', 'Contato Inicial', 80, '#6366f1', false, false, true, 'HM', 'ativacao')
on conflict (chave) do update set
  nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
  is_inicial = excluded.is_inicial, is_final = excluded.is_final, ativo = true,
  evento = excluded.evento, aba = excluded.aba;

update cs.estagios set ordem = 60  where evento = 'HM' and chave = 'hm_pendente_liberacao';
update cs.estagios set ordem = 70  where evento = 'HM' and chave = 'hm_acesso_liberado';
update cs.estagios set ordem = 90  where evento = 'HM' and chave = 'hm_entrevista_agendada';
update cs.estagios set ordem = 100, is_final = true where evento = 'HM' and chave = 'hm_entrevista_realizada';

-- 3) Aposenta "Apto para Ativação" -------------------------------------------
-- Move os cards ANTES de desativar: um card apontando para estágio inativo
-- some do board (a view junta por estagio_id, o kanban filtra por ativo).
with alvo as (
  select id from cs.estagios where evento = 'HM' and chave = 'hm_pendente_liberacao' limit 1
), origem as (
  select id from cs.estagios where evento = 'HM' and chave = 'hm_apto_ativacao' limit 1
), movidos as (
  update cs.contatos_hm ch
     set estagio_id = (select id from alvo), atualizado_em = now()
   where ch.estagio_id = (select id from origem)
  returning ch.id, (select id from origem) as de, (select id from alvo) as para
)
insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
select m.id, 'mudanca_estagio',
       'Etapa "Apto para Ativação" foi aposentada — card devolvido para "Pendente de Liberação"',
       'sistema', m.de, m.para
  from movidos m;

update cs.estagios set ativo = false where evento = 'HM' and chave = 'hm_apto_ativacao';
