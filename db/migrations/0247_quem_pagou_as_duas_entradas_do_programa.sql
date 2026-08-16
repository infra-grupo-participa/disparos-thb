-- 0247_quem_pagou_as_duas_entradas_do_programa.sql
-- Quem pagou as DUAS entradas do programa tinha R$ 300 ignorados — e cobrados de novo.
--
-- `cs.vw_hm_financeiro.pago_no_ciclo` exclui pagamento de `sinal` anterior à entrada corrente
-- quando a oferta é outra. A regra nasceu certa: servia para não contar o "Sinal 2k"
-- (`nz3ob9r2`, ofertado em evento) como parte do ciclo de quem depois pagou a entrada de
-- R$ 300 — são programas diferentes.
--
-- Só que a mesma regra derruba quem pagou as DUAS entradas do MESMO programa: R$ 300
-- (`z391kxd9`) em julho e R$ 697 (`rlgjsrul`) na live de 09/08. O primeiro sinal sumia da
-- conta e virava saldo devedor de novo.
--
-- MEDIDO — exatamente 2 pessoas, R$ 600 cobrados a mais:
--   José Maria Ferreira de Morais   pagou 997,01   sistema via 697,01   falta 14.302,99 → 14.002,99
--   Adreiza Farias de Oliveira      pagou 997,00   sistema via 697,00   falta 12.572,79 → 12.272,79
--
-- Nenhuma outra linha muda — a expressão corrigida foi rodada contra os 264 cards do HM
-- antes de aplicar. Achado na 4ª das dez rodadas de verificação pedidas pelo João em
-- 16/08/2026; ver disparos-brain/"As dez rodadas de verificação do financeiro".
--
-- A correção usa `hm_product_catalog.entrada_do_programa` (0240) — a coluna que separa a
-- entrada do programa das outras ofertas de categoria 'sinal'. Antes dela não havia como
-- escrever esta regra sem uma lista de códigos no meio da view.
--
-- Sem recolar a view (ela é enorme e alimenta kanban, tabela, travas e exports): troca
-- cirúrgica da expressão, com guard que FALHA se ela não estiver como esperado.

do $$
declare
  v_def  text;
  v_velho text := 'AND NOT (ent.pago_em IS NOT NULL AND p.pago_em < ent.pago_em AND p.categoria = ''sinal''::text AND p.oferta_codigo IS DISTINCT FROM ent.oferta_codigo)';
  v_novo  text := 'AND NOT (ent.pago_em IS NOT NULL AND p.pago_em < ent.pago_em AND p.categoria = ''sinal''::text AND p.oferta_codigo IS DISTINCT FROM ent.oferta_codigo AND NOT (EXISTS (SELECT 1 FROM hm_product_catalog c247 WHERE c247.offer_code = p.oferta_codigo AND c247.entrada_do_programa)))';
  v_qtd int;
begin
  select pg_get_viewdef('cs.vw_hm_financeiro'::regclass, true) into v_def;

  v_qtd := (length(v_def) - length(replace(v_def, v_velho, ''))) / nullif(length(v_velho), 0);
  if coalesce(v_qtd, 0) <> 1 then
    raise exception '0247: esperava 1 ocorrencia da regra de entrada anterior em vw_hm_financeiro, achei %. Conferir a view antes de aplicar.', coalesce(v_qtd, 0);
  end if;

  execute 'create or replace view cs.vw_hm_financeiro as ' || replace(v_def, v_velho, v_novo);
  raise notice '0247: pago_no_ciclo passa a contar as duas entradas do programa.';
end $$;

-- Conferencia nominal: os dois casos medidos precisam terminar com o saldo certo.
do $$
declare v_jm numeric; v_ad numeric;
begin
  select f.saldo_a_perseguir into v_jm from cs.vw_hm_financeiro f
    join public.compradores cp on cp.id = f.comprador_id
   where lower(cp.email) = 'jmmorais2010@gmail.com' limit 1;
  select f.saldo_a_perseguir into v_ad from cs.vw_hm_financeiro f
    join public.compradores cp on cp.id = f.comprador_id
   where lower(cp.email) = 'adreizza@gmail.com' limit 1;

  if v_jm is null or abs(v_jm - 14002.99) > 0.5 then
    raise exception '0247: Jose Maria deveria ficar com saldo 14.002,99 e ficou com %.', v_jm;
  end if;
  if v_ad is null or abs(v_ad - 12272.79) > 0.5 then
    raise exception '0247: Adreiza deveria ficar com saldo 12.272,79 e ficou com %.', v_ad;
  end if;
  raise notice '0247: conferido — Jose Maria %, Adreiza %.', v_jm, v_ad;
end $$;
