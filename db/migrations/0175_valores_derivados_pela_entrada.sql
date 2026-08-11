-- 0175_valores_derivados_pela_entrada.sql
-- `cs.fn_hm_valores_derivados` para de cravar 300 e 15000.
--
-- É o CONFLITO 4 do plano, e o mais grave da lista: esta função não só LÊ — o
-- `valor_total` que ela devolve é ESCRITO em `public.thb_alunos` por
-- `cs.fn_hm_provisionar_aluno`. Um aluno que entrou por uma porta de outro preço
-- nascia na base THB com o número errado, e ninguém percebe olhando o card.
--
-- Dois literais, dois efeitos:
--   `v_total := 300 + v_saldo_nominal`  → assume que TODA entrada custou 300. Quem
--                                         entrou pelos 697 e depois quitar o saldo
--                                         nasceria com R$ 397 a menos no total.
--   `v_total := 15000`                  → o pacote do HM até 10/08, cravado.
--
-- Passam a vir da porta de entrada (0174): `round(preço da entrada)` e
-- `cat.pacote_cheio`.
--
-- POR QUE `round()` E NÃO O PREÇO EXATO. A Hotmart grava a entrada como 299,99 ou
-- 300,01 conforme a conversão da transação — medido: dos 259 compradores com card,
-- 54 têm entrada ≠ 300,00 exatos, e os 8 que já pagaram saldo mudariam de
-- `valor_total` por UM CENTAVO. Centavo de ruído de gateway não é mudança de preço,
-- e o portão desta série é "zero card muda de valor". O preço da porta é o inteiro:
-- 300 vira 300, 697 vira 697.
--
-- A ordem do `select` da entrada é a MESMA da 0174 (data asc, oferta asc, id asc),
-- de propósito: se as duas escolhessem entradas diferentes para a mesma pessoa, o
-- card diria um valor e a base THB outro, sem erro em lugar nenhum.
--
-- MEDIDO ao aplicar: 259 compradores, **0 mudam de `valor_total`** em relação à
-- lógica antiga, delta R$ 0,00.
--
-- ⚠️ Achado colateral, NÃO causado por esta migration: 29 compradores têm
-- `public.thb_alunos.valor_total` divergente do que a função calcula hoje (delta
-- R$ 196.500). É histórico — o valor foi gravado num momento anterior, com os
-- dados de então. Fica registrado aqui para ser investigado com calma; corrigir em
-- massa mexeria em dinheiro de aluno e é decisão do Marcio.
-- Idempotente.
create or replace function cs.fn_hm_valores_derivados(p_comprador_id uuid)
 returns table(valor_total numeric, valor_pago numeric, ambiguo boolean)
 language plpgsql
 stable security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_soma         numeric := 0;
  v_cheia        numeric := 0;
  v_tem_sinal    boolean := false;
  v_installments boolean := false;
  v_saldo_nominal numeric;
  v_saldo_recorrente boolean := false;
  v_total        numeric;
  v_pago         numeric;
  v_entrada_valor  numeric;   -- 0175
  v_entrada_pacote numeric;   -- 0175
begin
  select coalesce(sum(c.preco), 0),
         coalesce(sum(c.preco) filter (where cat.categoria = 'compra_cheia'), 0),
         bool_or(cat.categoria = 'sinal'),
         bool_or(c.metodo_pagamento = 'HOTMART_INSTALLMENTS')
    into v_soma, v_cheia, v_tem_sinal, v_installments
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia','diferenca');

  -- 0175: a PORTA de entrada. Mesma ordem total da 0174.
  select round(c.preco), cat.pacote_cheio
    into v_entrada_valor, v_entrada_pacote
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria = 'sinal'
     and cat.pacote_cheio is not null
   order by coalesce(c.data_aprovacao, c.data_compra) asc, c.oferta_codigo asc, c.id asc
   limit 1;

  select os.valor, os.recorrente into v_saldo_nominal, v_saldo_recorrente
    from public.compras c
    join cs.hm_ofertas_saldo os on os.codigo = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_tem_sinal and v_saldo_nominal is not null then
    v_total := coalesce(v_entrada_valor, 300) + v_saldo_nominal;   -- 0175 (era 300 fixo)
  elsif v_tem_sinal then
    v_total := coalesce(v_entrada_pacote, 15000::numeric);         -- 0175 (era 15000 fixo)
  elsif v_installments and v_cheia < 15000 then
    v_total := 15000::numeric;
  else
    v_total := v_cheia;
  end if;

  v_pago := least(v_soma, v_total);
  if v_total - v_pago < 1 then v_pago := v_total; end if;

  return query select
    v_total,
    v_pago,
    (v_installments or (v_saldo_recorrente and v_pago < v_total) or v_pago < v_total);
end$function$;
