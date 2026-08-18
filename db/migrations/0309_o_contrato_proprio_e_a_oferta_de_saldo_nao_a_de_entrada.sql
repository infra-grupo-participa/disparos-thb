-- 0309: o contrato próprio é a oferta de SALDO, não a de entrada
--
-- 🔴 CORREÇÃO DE DEFEITO DAS 0307/0308.
--
-- Ambas identificavam o contrato próprio por `cat.entrada_do_programa = true`.
-- Está invertido. Os dados provam:
--
--   Sebastião (Clínica GO, contrato próprio de R$ 13.000):
--     ulimhvmd → papel='saldo', categoria='diferenca',
--                entrada_do_programa=FALSE, valor_tabela=13.000  ← o contrato
--     rlgjsrul → papel='entrada', valor_tabela=697   (nem casa com AURUM)
--
--   Vanda (ETHB SP, tem que seguir a régua de R$ 59.000):
--     qm4lu7py → papel='entrada', entrada_do_programa=TRUE,
--                valor_tabela=1.000  ← é a TAXA DE INSCRIÇÃO, não um contrato
--
-- Com o critério antigo a 0308 carimbava R$ 1.000 na Vanda e o saldo dela
-- despencava de R$ 59.000 para R$ 1.000 — dívida real sumindo do relatório.
-- Foi assim que o defeito apareceu: o teste da 0308 rodou contra os dois casos
-- e devolveu retorno=NULL para o contrato próprio e retorno=1000 para o
-- controle. Exatamente o oposto do esperado.
--
-- ⚠️ Aquele teste rodou SEM transação e escreveu em produção (Sebastião voltou a
-- R$ 55.528, Vanda caiu para R$ 1.000). Os dois cards foram recompostos pelo
-- critério correto antes desta migration; ela fixa a regra no código para que
-- não volte. Lição: teste de função que ESCREVE vai dentro de
-- `begin ... rollback`, sempre.
--
-- Critério correto: a oferta com papel='saldo' e valor_tabela próprio que a
-- pessoa comprou e teve aprovada. É o saldo contratado dela.

-- ── A função passa a usar papel='saldo' ────────────────────────────────────
create or replace function cs.fn_hm_carimbar_contrato_aurum(p_comprador_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_valor numeric;
begin
  -- 0309: papel='saldo' — o contrato PRÓPRIO da pessoa. NÃO entrada_do_programa,
  -- que marca a taxa de inscrição do evento (ver o cabeçalho desta migration).
  select cat.valor_tabela into v_valor
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo::text
   where c.comprador_id = p_comprador_id
     and cat.papel = 'saldo'
     and cat.valor_tabela is not null
     and cs.fn_hm_pagamento_do_produto(cat.offer_code, 'AURUM')
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_valor is null then
    -- Sem contrato próprio: segue a régua de cs.aurum_parametros. Limpa um
    -- carimbo antigo se existir, para que critério errado não fique grudado.
    update cs.contatos_hm
       set contrato_aurum = null, atualizado_em = now()
     where comprador_id = p_comprador_id
       and coalesce(produto, 'HM') = 'AURUM'
       and contrato_aurum is not null;
    return null;
  end if;

  update cs.contatos_hm
     set contrato_aurum = v_valor,
         atualizado_em  = now()
   where comprador_id = p_comprador_id
     and coalesce(produto, 'HM') = 'AURUM'
     and contrato_aurum is distinct from v_valor;

  return v_valor;
end $fn$;

comment on function cs.fn_hm_carimbar_contrato_aurum(uuid) is
  '0309 (corrige 0308): grava cs.contatos_hm.contrato_aurum com o valor_tabela da oferta de papel=''saldo'' que a pessoa comprou e teve aprovada — o contrato PROPRIO dela (ex.: Clinica de Goiania, R$ 13.000). NAO usa entrada_do_programa: aquela flag marca a taxa de inscricao do evento (ETHB SP, R$ 1.000), e usa-la fazia o saldo de quem e de SP despencar de 59.000 para 1.000. Retorna o valor gravado ou NULL (segue a regua de cs.aurum_parametros). Idempotente, e limpa carimbo antigo quando a pessoa nao tem mais contrato proprio. Chamada por cs.fn_tag_hm_origem.';

grant execute on function cs.fn_hm_carimbar_contrato_aurum(uuid) to disparos_app;

-- ── Recompõe a coluna pelo critério correto ────────────────────────────────
update cs.contatos_hm ch
   set contrato_aurum = src.valor_tabela
  from (
    select distinct on (c.comprador_id) c.comprador_id, cat.valor_tabela
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo::text
     where cat.papel = 'saldo' and cat.valor_tabela is not null
       and cs.fn_hm_pagamento_do_produto(cat.offer_code, 'AURUM')
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
     order by c.comprador_id, coalesce(c.data_aprovacao, c.data_compra) desc
  ) src
 where ch.comprador_id = src.comprador_id
   and coalesce(ch.produto,'HM') = 'AURUM'
   and ch.contrato_aurum is distinct from src.valor_tabela;

update cs.contatos_hm ch
   set contrato_aurum = null
 where coalesce(ch.produto,'HM') = 'AURUM'
   and ch.contrato_aurum is not null
   and not exists (
     select 1 from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo::text
     where c.comprador_id = ch.comprador_id
       and cat.papel = 'saldo' and cat.valor_tabela is not null
       and cs.fn_hm_pagamento_do_produto(cat.offer_code,'AURUM')
       and c.status in ('APPROVED','COMPLETE','COMPLETED'));

-- ── Travas: os dois casos que expuseram o defeito ──────────────────────────
do $$
declare
  v_seb numeric; v_van numeric; v_n int;
begin
  select round(f.saldo_a_perseguir) into v_seb
    from cs.contatos_hm ch join public.compradores cp on cp.id=ch.comprador_id
    join cs.vw_hm_financeiro f on f.contato_hm_id=ch.id
   where ch.produto='AURUM' and cp.nome ilike 'Sebastiao Jose da Silva%';

  select round(f.saldo_a_perseguir) into v_van
    from cs.contatos_hm ch join public.compradores cp on cp.id=ch.comprador_id
    join cs.vw_hm_financeiro f on f.contato_hm_id=ch.id
   where ch.produto='AURUM' and cp.nome ilike 'Vanda Amorim%';

  select count(*) into v_n from cs.contatos_hm
   where produto='AURUM' and contrato_aurum is not null;

  if v_seb is null or v_seb > 15000 then
    raise exception '0309: contrato proprio errado (Sebastiao=%). Esperado ~9.528. Abortando.', v_seb;
  end if;
  if v_van is distinct from 59000 then
    raise exception '0309: controle ETHB SP contaminado (Vanda=%). Esperado 59.000. Abortando.', v_van;
  end if;

  raise notice '0309: % card(s) com contrato proprio. Sebastiao=% · Vanda=%.', v_n, v_seb, v_van;
end $$;

-- ── Verificado ──────────────────────────────────────────────────────────────
-- Teste dos 3 casos dentro de `begin ... rollback`:
--   contrato próprio zerado → função recompõe 13.000 · 2ª chamada idempotente
--   controle ETHB SP        → retorno NULL, coluna intacta
--   carimbo indevido (1000) → função limpa para NULL
--
-- EXPLAIN ANALYZE do LATERAL aurum sobre 100 cards do board:
--   plano idêntico ao de antes (Index Scan + Memoize, nenhum passo novo).
--   A função de leitura (cs.fn_aurum_saldo) não mudou — só lê a coluna.
