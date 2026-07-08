-- =====================================================================
-- 0038_cs_hm_seed_resiliente
-- Blinda o tagueamento HT ATM dentro do trigger de venda: o registro da compra
-- (public.compras) é crítico e NÃO pode ser abortado se o tagueamento falhar.
--
-- Antes, cs.fn_tag_ht_atm_comprador era chamada via `perform` solto no trigger;
-- qualquer exceção dela (ex.: public.vw_aluno_360 indisponível/permissão) faria
-- o INSERT da compra sofrer rollback — ou seja, o webhook da Hotmart perderia a
-- venda por causa de um detalhe secundário (a tag).
--
-- Agora o `perform` roda dentro de um bloco `begin/exception when others`, que
-- registra a falha na timeline do card mas deixa a compra ser gravada. O sync
-- em lote cs.fn_sync_hm_atm() continua servindo de rede de segurança para
-- reprocessar qualquer caso que tenha falhado. Idempotente.
-- =====================================================================

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
  -- aprovada anterior do mesmo comprador+oferta, esta é uma parcela — ignora.
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

    -- HT ATM: taguear + enriquecer na hora, mas NUNCA derrubar o registro da
    -- compra se o tagueamento falhar (a tag é secundária; a venda é crítica).
    if v_notes ilike '%HT ATM%' then
      begin
        perform cs.fn_tag_ht_atm_comprador(new.comprador_id);
      exception when others then
        if v_id is not null then
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Falha ao aplicar tag HT ATM automaticamente ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
        end if;
      end;
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
