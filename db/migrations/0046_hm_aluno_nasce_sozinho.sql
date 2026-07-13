-- =====================================================================
-- 0046_hm_aluno_nasce_sozinho
-- O aluno passa a nascer na base mestre sem ninguém digitar: quando a Hotmart
-- aprova uma compra que QUITA a formação, o gatilho provisiona o cadastro.
--
-- Definição de aluno (decidida com o time): entra na base quem quitou a
-- formação — 'compra_cheia' aprovada ou 'diferenca' (o saldo do sinal) paga.
-- Quem pagou só o sinal de R$300 NÃO vira aluno: segue como card na esteira
-- até o saldo entrar. Reserva e renovação não criam cadastro.
--
-- Os valores financeiros são derivados por cs.fn_hm_valores_derivados, que é
-- honesta sobre o que não sabe: `compras.preco` guarda o valor da PARCELA em
-- boleto parcelado (HOTMART_INSTALLMENTS) e, em alguns cartões parcelados,
-- também. Quando o número é ambíguo, o cadastro nasce com `tratamento_manual`
-- preenchido, para conferência humana — em vez de afirmar um financeiro errado.
--
-- Idempotente: cs.fn_hm_provisionar_aluno faz upsert e os índices únicos de
-- comprador_id / e-mail impedem duplicata mesmo com webhook e kanban juntos.
-- =====================================================================

-- 1) Valores derivados das compras HM do comprador ---------------------------
create or replace function cs.fn_hm_valores_derivados(p_comprador_id uuid)
returns table (valor_total numeric, valor_pago numeric, ambiguo boolean)
language plpgsql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_soma        numeric := 0;  -- tudo que a Hotmart registrou como pago
  v_cheia       numeric := 0;
  v_tem_sinal   boolean := false;
  v_installments boolean := false;
  v_total       numeric;
  v_pago        numeric;
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

  -- Entrou pelo sinal de R$300 → o pacote é 15.000 (300 + 14.700).
  -- Entrou pela compra cheia → o pacote é o preço da própria compra.
  v_total := case when v_tem_sinal then 15000::numeric else v_cheia end;
  v_pago  := least(v_soma, v_total);

  -- Centavos de arredondamento da Hotmart (ex.: 14.999,98) não são dívida.
  if v_total - v_pago < 1 then v_pago := v_total; end if;

  return query select
    v_total,
    v_pago,
    -- Ambíguo quando o número pode ser parcela, não total pago.
    (v_installments or v_pago < v_total);
end$fn$;

-- 2) O gatilho de venda passa a provisionar o aluno --------------------------
-- Mantém tudo que a 0042 já fazia (card, timeline, tags, guarda de parcela) e
-- acrescenta o provisionamento. O `begin/exception` blinda a compra: a base
-- mestre é de outro domínio e uma falha lá NUNCA pode derrubar o registro da
-- venda vinda do webhook da Hotmart.
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
  v_pend  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
  v_val   record;
  v_aluno uuid;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  -- Parcela de parcelamento (HOTMART_INSTALLMENTS): a Hotmart reenvia um
  -- PURCHASE_APPROVED por parcela. Se já existe compra aprovada anterior do
  -- mesmo comprador+oferta, esta é uma parcela — ignora.
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
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

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

    begin
      perform cs.fn_tag_hm_origem(new.comprador_id);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;

    -- Compra cheia QUITA a formação → o aluno nasce agora.
    -- Sinal sozinho não: fica só como card até o saldo entrar.
    if v_cat = 'compra_cheia' then
      begin
        select * into v_val from cs.fn_hm_valores_derivados(new.comprador_id);
        v_aluno := cs.fn_hm_provisionar_aluno(new.comprador_id, v_val.valor_total, v_val.valor_pago);
        if v_aluno is not null then
          if v_val.ambiguo then
            update public.thb_alunos
               set tratamento_manual = coalesce(tratamento_manual,
                     'Financeiro a conferir — criado pelo webhook em '||to_char(now(),'DD/MM/YYYY')||': a Hotmart pode ter gravado valor de parcela')
             where id = v_aluno;
          end if;
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Aluno criado na base THB (compra cheia quitada)', 'sistema');
        end if;
      exception when others then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao criar o aluno na base THB ('||sqlerrm||')', 'sistema');
      end;
    end if;
    return new;
  end if;

  -- DIFERENÇA (saldo do sinal): quita a formação → card vai para a Ativação e
  -- o aluno nasce na base.
  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_pend,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_pend;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — pendente de liberação', 'sistema');
      end if;

      begin
        select * into v_val from cs.fn_hm_valores_derivados(new.comprador_id);
        v_aluno := cs.fn_hm_provisionar_aluno(new.comprador_id, v_val.valor_total, v_val.valor_pago);
        if v_aluno is not null then
          if v_val.ambiguo then
            update public.thb_alunos
               set tratamento_manual = coalesce(tratamento_manual,
                     'Financeiro a conferir — criado pelo webhook em '||to_char(now(),'DD/MM/YYYY')||': a Hotmart pode ter gravado valor de parcela')
             where id = v_aluno;
          end if;
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Aluno criado na base THB (saldo quitado)', 'sistema');
        end if;
      exception when others then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao criar o aluno na base THB ('||sqlerrm||')', 'sistema');
      end;
    end if;
    return new;
  end if;

  return new;
end$function$;

grant execute on function cs.fn_hm_valores_derivados(uuid) to disparos_app;
