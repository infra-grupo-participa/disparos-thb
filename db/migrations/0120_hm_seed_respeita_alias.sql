-- =====================================================================
-- 0120_hm_seed_respeita_alias
--
-- A 0119 passou a CRIAR card quando um pagamento de saldo chega sem card.
-- Mas quando a pessoa tem DOIS cadastros na Hotmart (sinal num e-mail, saldo
-- noutro) o segundo cadastro é um alias do canônico (cs.hm_comprador_alias).
-- Sem tratar o alias, o gatilho criava um card DUPLICADO para o cadastro-gêmeo
-- (aconteceu com Carita e Renato em 22/07). Correção: resolver o comprador
-- CANÔNICO no topo e operar sempre sobre ele — o pagamento do gêmeo passa a
-- atualizar o card do canônico, nunca a duplicar. A detecção de parcela segue
-- pelo comprador que pagou (as parcelas do gêmeo vêm sempre no mesmo cadastro).
-- Idempotente.
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
  v_pend  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
  v_val   record;
  v_aluno uuid;
  v_quando timestamptz;
  v_comprador uuid;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  -- Resolve o comprador CANÔNICO: se este cadastro é um alias (mesma pessoa,
  -- segundo e-mail da Hotmart), tudo opera no card do canônico — nunca duplica.
  v_comprador := coalesce(
    (select canonico_id from cs.hm_comprador_alias where comprador_id = new.comprador_id),
    new.comprador_id);

  -- Parcela: detecta pelo cadastro que efetivamente pagou (new.comprador_id).
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

  v_quando := coalesce(new.data_aprovacao, new.data_compra, now());
  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

  if v_cat in ('sinal','compra_cheia') and v_quando >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
    values (v_comprador, v_ini, 'T39', v_notes, v_cat)
    on conflict (comprador_id) do update
      set plano = coalesce(cs.contatos_hm.plano, excluded.plano),
          categoria_entrada = coalesce(cs.contatos_hm.categoria_entrada, excluded.categoria_entrada),
          atualizado_em = now();

    select id into v_id from cs.contatos_hm where comprador_id = v_comprador;
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema', 'Entrou na esteira HM ('||v_cat||' — '||coalesce(v_notes,'oferta')||')', 'sistema');
    end if;

    begin
      perform cs.fn_tag_hm_origem(v_comprador);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;

    if v_cat = 'compra_cheia' then
      update cs.contatos_hm
         set estagio_id = v_pend,
             apto_ativacao = true,
             pagamento_em = coalesce(pagamento_em, v_quando),
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_pend;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
        values (v_id, 'mudanca_estagio',
                'Compra cheia aprovada (Hotmart) — direto para "Pendente de Liberação"',
                'sistema', v_ini, v_pend);
      end if;

      begin
        select * into v_val from cs.fn_hm_valores_derivados(v_comprador);
        v_aluno := cs.fn_hm_provisionar_aluno(v_comprador, v_val.valor_total, v_val.valor_pago);
        if v_aluno is not null then
          if v_val.ambiguo then
            update public.thb_alunos
               set tratamento_manual = coalesce(tratamento_manual,
                     'Financeiro a conferir — criado pelo webhook em '||to_char(now(),'DD/MM/YYYY')||': a Hotmart pode ter gravado valor de parcela')
             where id = v_aluno;
          end if;
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Aluno criado/atualizado na base THB (compra cheia)', 'sistema');
        end if;
      exception when others then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao criar o aluno na base THB ('||sqlerrm||')', 'sistema');
      end;
    end if;
    return new;
  end if;

  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = v_comprador;

    -- Comprador pagou o saldo mas o canônico ainda não tem card (entrou direto
    -- pela oferta de saldo, sem sinal): cria em "Pendente de Liberação".
    if v_id is null and v_quando >= v_cutoff then
      insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada, apto_ativacao, pagamento_em)
      values (v_comprador, v_pend, 'T39', coalesce(v_notes, 'saldo'), 'diferenca', true, v_quando)
      on conflict (comprador_id) do nothing;

      select id into v_id from cs.contatos_hm where comprador_id = v_comprador;

      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema',
                'Entrou direto pela oferta de saldo (sem sinal) — card criado pelo pagamento do saldo', 'sistema');
        begin
          perform cs.fn_tag_hm_origem(v_comprador);
        exception when others then
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
        end;
      end if;
    end if;

    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, v_quando),
             estagio_id = v_pend,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_pend;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — pendente de liberação', 'sistema');
      end if;

      begin
        select * into v_val from cs.fn_hm_valores_derivados(v_comprador);
        v_aluno := cs.fn_hm_provisionar_aluno(v_comprador, v_val.valor_total, v_val.valor_pago);
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
