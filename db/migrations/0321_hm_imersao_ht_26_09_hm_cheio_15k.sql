-- 0321 — HM cheio R$ 15 mil da Imersão HT (26–27/09/2026)
--
-- Pedido do João (26/09): toda compra do Holding Masters no valor cheio de
-- R$ 15 mil (oferta 6fceg8ye, checkout L97981750T) cai no sistema como venda do
-- canal "Imersão HT", quitada, com vencimento de acesso em +365 dias — inclusive
-- quem comprar depois do evento e inclusive aluno da base.
--
-- APLICADO no banco em 26/09/2026 (o catálogo e a origem por INSERT via MCP; a
-- função via apply_migration). Este arquivo é o registro, idempotente.
--
-- Por que três peças:
--   1. Oferta fora de public.hm_product_catalog = o webhook grava a compra e NÃO
--      cria card, pagamento nem aluno (armadilha "oferta órfã"). `compra_cheia`
--      manda o card direto para "Pendente de Liberação" e provisiona o aluno
--      (cs.fn_hm_provisionar_aluno: data_expiracao = compra + 365 dias).
--   2. Canal por OFERTA (cs.hm_origem_por_oferta), não por janela de data: a
--      janela (cs.hm_evento_janela) só é datada pelo SINAL — compra cheia sem sinal
--      caía em "HM - Programa de Implementação"/"Venda direta" (medido em rollback).
--   3. cs.fn_hm_canal tem a lista de canais FIXA (armadilha 0128): sem a linha nova
--      o board do financeiro (vw_fin_contas_receber → vw_fin_board) mostraria
--      "Não classificado". Mudança mínima: 0 cards tinham a tag; o total de
--      "Não classificado" ficou 126 antes e depois.
--
-- Provado em rollback antes de aplicar (cartão 12x, PIX, boleto impresso→pago):
-- card HM em hm_pendente_liberacao, tags [Aluno novo, Imersão HT - 26-09, Turma T41],
-- cs.hm_pagamentos 1 linha compra_cheia 15000, thb_alunos quitado com expiração
-- 2027-09-26, vw_hm_financeiro quitado/saldo 0, fn_fin_board canal certo,
-- fn_fin_faturamento_diario soma a venda no dia.
--
-- ⚠️ Fica para decisão (NÃO tocado aqui): 126 cards (91 HM, 35 AURUM) já aparecem
-- "Não classificado" no financeiro — HT29/HT30/ETHB SP nunca entraram nesta lista.

insert into public.hm_product_catalog (product_id, offer_code, product_name, product_type, notes,
  categoria, concede_trilha, pacote_cheio, valor_tabela, nome_comercial, link, produto_checkout,
  ativo, origem_do_dado, origem_ref, atualizado_por, atualizado_em)
select '5064314','6fceg8ye','Holding Masters','hm','HM 15k — valor cheio (Imersão HT 26-09)',
  'compra_cheia', true, 15000, 15000, 'Holding Masters - valor cheio R$ 15.000',
  'https://pay.hotmart.com/L97981750T?off=6fceg8ye', 'L97981750T',
  true, 'manual', 'João 26/09/2026 — oferta da Imersão HT', 'claude-26-09', now()
where not exists (select 1 from public.hm_product_catalog where offer_code = '6fceg8ye');

insert into cs.hm_origem_por_oferta (oferta_codigo, origem, nota, produto, vale_de, vale_ate)
select '6fceg8ye', 'Imersão HT - 26-09',
  'Imersão HT de 26 e 27/09/2026. Decisão do João (26/09): TODA compra do HM cheio R$ 15 mil nesta oferta é deste canal, inclusive depois do evento e inclusive aluno da base. Sem fim.',
  'HM', '2026-09-26 03:00+00', null
where not exists (select 1 from cs.hm_origem_por_oferta where oferta_codigo = '6fceg8ye');

create or replace function cs.fn_hm_canal(p_tags text[])
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when 'Imersão HT - 26-09'             = any(p_tags) then 'Imersão HT - 26-09'
    when 'HM - Programa de Implementação' = any(p_tags) then 'HM - Programa de Implementação'
    when 'HT ATM'                         = any(p_tags) then 'HT ATM'
    when 'HT28'                           = any(p_tags) then 'HT28'
    when 'HT27'                           = any(p_tags) then 'HT27'
    when 'HT26'                           = any(p_tags) then 'HT26'
    when 'Ex aluno Direto ao Ponto'       = any(p_tags) then 'Ex aluno Direto ao Ponto'
    when 'Live Direto ao Ponto'           = any(p_tags) then 'Live Direto ao Ponto'
    when 'Imersão POA'                    = any(p_tags) then 'Imersão POA'
    when 'Venda direta'                   = any(p_tags) then 'Venda direta'
    else 'Não classificado'
  end;
$function$;
