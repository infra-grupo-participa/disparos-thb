-- =====================================================================
-- 0037_cs_hm_ignora_parcela
-- Corrige a classificação de PARCELAS de parcelamento no seed do HM.
--
-- Problema: para compras parceladas via Hotmart (metodo HOTMART_INSTALLMENTS,
-- ex.: "Boleto parcelado" 12x), a Hotmart reenvia um PURCHASE_APPROVED por
-- parcela paga, com transação NOVA e numero_recorrencia nulo. O trigger
-- cs.fn_seed_contato_hm tratava cada parcela como uma compra_cheia nova —
-- criando/movimentando cards indevidamente. Ex.: a compradora comprou a cheia
-- parcelada em 05/05 (antes do corte T39) e a parcela de 07/07 (após o corte)
-- criou um card "novo" no board T39, como se fosse venda da campanha atual.
--
-- Correção:
--  1) Guarda no trigger: se a compra é HOTMART_INSTALLMENTS e já existe uma
--     compra aprovada ANTERIOR do mesmo comprador+oferta, é parcela — ignora
--     (não semeia, não move, não marca pagamento). Restrito a INSTALLMENTS
--     para não afetar cartão parcelado (que é uma única transação/evento).
--  2) Limpeza pontual: remove os cards que hoje existem apenas por causa de
--     uma parcela (sem nenhuma "entrada real" sinal/compra_cheia >= corte que
--     não seja parcela). A timeline cai por cascade. Hoje: 1 card (Neide).
-- =====================================================================

-- 1) Trigger de seed com a guarda de parcela ---------------------------------
create or replace function cs.fn_seed_contato_hm()
returns trigger
language plpgsql
security definer
set search_path to 'cs', 'public'
as $function$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_apto  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  -- Parcela de parcelamento (HOTMART_INSTALLMENTS): a Hotmart reenvia um
  -- PURCHASE_APPROVED por parcela, com transação nova. Se já existe compra
  -- aprovada anterior do mesmo comprador+oferta, esta é uma parcela — não é
  -- entrada nova nem renovação. Ignora.
  if new.metodo_pagamento = 'HOTMART_INSTALLMENTS' and exists (
    select 1 from public.compras c2
     where c2.comprador_id = new.comprador_id
       and c2.oferta_codigo = new.oferta_codigo
       and c2.status in ('APPROVED','COMPLETE','COMPLETED')
       and c2.id <> new.id
       and coalesce(c2.data_aprovacao, c2.data_compra) < coalesce(new.data_aprovacao, new.data_compra)
  ) then
    return new;
  end if;

  select cat.categoria, cat.notes into v_cat, v_notes
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if v_cat is null then
    return new;
  end if;

  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_apto from cs.estagios where evento='HM' and chave='hm_apto_ativacao' limit 1;

  if v_cat in ('sinal','compra_cheia')
     and coalesce(new.data_aprovacao, new.data_compra, now()) >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
    values (new.comprador_id, v_ini, 'T39', v_notes, v_cat)
    on conflict (comprador_id) do update
      set plano = coalesce(cs.contatos_hm.plano, excluded.plano),
          categoria_entrada = coalesce(cs.contatos_hm.categoria_entrada, excluded.categoria_entrada),
          atualizado_em = now();

    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema', 'Entrou na esteira HM ('||v_cat||' — '||coalesce(v_notes,'oferta')||')', 'sistema');
    end if;

    if v_notes ilike '%HT ATM%' then
      perform cs.fn_tag_ht_atm_comprador(new.comprador_id);
    end if;
    return new;
  end if;

  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_apto,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_apto;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — apto para ativação', 'sistema');
      end if;
    end if;
    return new;
  end if;

  return new;
end$function$;

-- 2) Limpeza pontual: cards que existem só por causa de uma parcela ----------
with entradas as (
  select c.comprador_id, c.oferta_codigo, coalesce(c.data_aprovacao, c.data_compra) as dt, c.id
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where cat.categoria in ('sinal','compra_cheia')
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
),
entrada_real as (
  select distinct e.comprador_id
    from entradas e
   where e.dt >= '2026-06-25 00:00:00+00'
     and not exists (
       select 1 from public.compras c2
        where c2.comprador_id = e.comprador_id and c2.oferta_codigo = e.oferta_codigo
          and c2.status in ('APPROVED','COMPLETE','COMPLETED')
          and c2.id <> e.id
          and coalesce(c2.data_aprovacao, c2.data_compra) < e.dt
     )
)
delete from cs.contatos_hm ch
 where ch.comprador_id not in (select comprador_id from entrada_real)
   and exists (  -- só cards órfãos causados por parcela (segurança)
     select 1 from public.compras c
      where c.comprador_id = ch.comprador_id
        and c.metodo_pagamento = 'HOTMART_INSTALLMENTS'
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
   );
