-- =====================================================================
-- 0121_hm_virada_t40_por_data_de_compra
--
-- Prepara a virada T39 → T40 (abertura de carrinho: domingo 26/07/2026 20h BRT,
-- após o pitch). A turma do card passa a ser decidida pela DATA DA COMPRA (não
-- pela aprovação): quem comprou o sinal até 26/07 20h é T39; a partir daí, T40.
-- Boleto da T39 pago depois continua T39. Vira sozinho na data — ninguém mexe
-- no domingo. Antes, o gatilho cravava 'T39' na mão.
--
-- Corte único = thb_turmas.sale_end_at da T39 = sale_start_at da T40
-- (2026-07-26 23:00:00+00 = 20h de Brasília). Ajustar aí se a hora mudar.
-- =====================================================================

-- 1) Turma T40 (idempotente) + janelas de venda das duas turmas
insert into public.thb_turmas (codigo, tipo, sale_start_at, sale_end_at, atual)
select 'T40', 'thb', '2026-07-26 23:00:00+00', null, false
where not exists (select 1 from public.thb_turmas where codigo = 'T40');

update public.thb_turmas set sale_start_at = '2026-06-25 03:00:00+00',
                             sale_end_at   = '2026-07-26 23:00:00+00'
 where codigo = 'T39';

update public.thb_turmas set sale_start_at = '2026-07-26 23:00:00+00',
                             sale_end_at   = null
 where codigo = 'T40';

-- 2) Turma pela data da venda: a turma cuja janela [start, end) contém o timestamp.
--    Fallback = turma atual (config), para datas fora de qualquer janela.
create or replace function cs.fn_hm_turma_por_data(p_venda_em timestamptz)
 returns text
 language sql
 stable security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select coalesce(
    (select t.codigo from public.thb_turmas t
      where t.tipo = 'thb' and t.sale_start_at is not null
        and p_venda_em >= t.sale_start_at
        and (t.sale_end_at is null or p_venda_em < t.sale_end_at)
      order by t.sale_start_at desc
      limit 1),
    cs.fn_hm_turma_atual());
$function$;

-- 3) Gatilho de seed: turma do card = fn_hm_turma_por_data(data da compra),
--    no lugar do 'T39' cravado. Resto idêntico à 0120 (resolve alias no topo).
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
  v_turma text;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  v_comprador := coalesce(
    (select canonico_id from cs.hm_comprador_alias where comprador_id = new.comprador_id),
    new.comprador_id);

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
  -- Turma pela DATA DA COMPRA (decisão 22/07): boleto da T39 pago depois continua T39.
  v_turma  := cs.fn_hm_turma_por_data(coalesce(new.data_compra, new.data_aprovacao, now()));
  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

  if v_cat in ('sinal','compra_cheia') and v_quando >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
    values (v_comprador, v_ini, v_turma, v_notes, v_cat)
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

    if v_id is null and v_quando >= v_cutoff then
      insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada, apto_ativacao, pagamento_em)
      values (v_comprador, v_pend, v_turma, coalesce(v_notes, 'saldo'), 'diferenca', true, v_quando)
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
