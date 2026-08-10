-- 0164_status_no_outro_portal.sql
-- "É interessante a gente colocar o card e outros portais também com a informação
--  sobre o status dele no outro CRM" (Marcio, 10/08).
--
-- A 0163 deu à mesma pessoa um card em cada board, e a sincronia de lá só escreve na
-- TIMELINE — o operador precisa rolar o histórico para descobrir. Aqui a informação
-- sobe para o CARD: um selo "HM: Entrevista Finalizada" no card do Aurum (e vice-versa).
--
-- Por que importa: hoje 15 pessoas têm card nos dois boards, e várias estão em
-- estágios MUITO diferentes — a Vania está em "Acesso Liberado" no HM enquanto o
-- Aurum a trata como "Contato Inicial". Sem o selo, o operador do Aurum aborda como
-- se fosse contato novo alguém que já é aluno ativo do outro lado.
--
-- ⚠️ ESTA MIGRATION VEM COM UMA CORREÇÃO DE REGRESSÃO (ver no fim): a 0163 quebrou os
-- joins que casavam por comprador_id. É por isso que a view abaixo devolve o
-- `contato_hm_id` — a chave passa a ser o CARD, não a pessoa.

create or replace view cs.vw_card_outros_portais as
select ch.id            as contato_hm_id,
       ch.comprador_id,
       ch.produto       as produto_deste_card,
       o.produto        as outro_produto,
       oe.nome          as outro_estagio,
       oe.aba           as outro_aba,
       o.apto_ativacao  as outro_apto,
       o.pagamento_em   as outro_pagamento_em,
       o.aluno_id is not null as outro_tem_matricula,
       ou.nome          as outro_responsavel,
       o.atualizado_em  as outro_atualizado_em
  from cs.contatos_hm ch
  join cs.contatos_hm o
    on o.comprador_id = ch.comprador_id and o.id <> ch.id
  left join cs.estagios oe on oe.id = o.estagio_id
  left join cs.usuarios ou on ou.id = o.responsavel_id;

comment on view cs.vw_card_outros_portais is
  'Situacao da mesma pessoa nos OUTROS boards (0164). Alimenta o selo no card: o operador do Aurum ve em que etapa ela esta no HM sem trocar de portal.';

grant select on cs.vw_card_outros_portais to disparos_app;

-- ---------------------------------------------------------------------------
-- 🐛 REGRESSÃO DA 0163 CORRIGIDA JUNTO (no código, não aqui)
--
-- Com card por PESSOA × PRODUTO, todo join `on X.comprador_id = k.comprador_id`
-- passou a casar os DOIS cards da mesma pessoa. Medido no board do Aurum:
-- **80 linhas para 35 cards** — o board multiplicava os cards e ainda podia trazer o
-- financeiro do board errado (a Jessica aparecia com o saldo do HM no card do Aurum).
--
-- Corrigido em:
--   · app/api/hm/kanban/route.ts   → join por `ch2.id = k.contato_hm_id`
--                                     e `fin.contato_hm_id = k.contato_hm_id`
--   · lib/services/hm-relatorio.ts → idem (tabela/relatório)
--   · lib/services/hm-ficha.ts     → fichaHm(compradorId, produto): a ficha é aberta
--                                     por comprador_id e devolvia um card AO ACASO;
--                                     clicar no card do Aurum podia abrir a ficha do HM
--
-- 🔑 PADRÃO: ao trocar a granularidade de uma tabela (pessoa → pessoa×produto),
-- procurar TODO join e TODA busca pela chave antiga. `grep "comprador_id ="` é o
-- primeiro passo — o que não for ajustado não dá erro, só devolve linha a mais ou
-- registro errado.
-- ---------------------------------------------------------------------------
