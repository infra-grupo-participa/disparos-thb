-- 0171_seed_hm_usa_a_chave_certa.sql
-- ACHADO CRÍTICO, encontrado no teste de venda simulada de 10/08 21h — a poucas
-- horas da live que ia usar exatamente este caminho.
--
-- `cs.fn_seed_contato_hm` apontava para uma constraint que não existe mais. A
-- 0163 trocou a chave de `cs.contatos_hm` de UNIQUE(comprador_id) para
-- UNIQUE(comprador_id, produto) — card por PESSOA × PRODUTO — e o seed ficou com
-- `on conflict (comprador_id)`:
--
--     ERROR 42P10: there is no unique or exclusion constraint matching the
--     ON CONFLICT specification
--
-- O erro sobe DENTRO do trigger AFTER INSERT de `public.compras`, então a
-- transação inteira volta: não entra compra, não nasce card, não entra pagamento.
-- A venda simplesmente não acontece para o sistema.
--
-- Por que ninguém tinha visto: as vendas de hoje foram de categoria 'reserva'
-- (que não entra em nenhum ramo do seed) e 'diferenca' de gente com card já
-- criado. A próxima venda de SINAL — a oferta R$697 da live — cairia direto no
-- erro. Passou pelo build e pelo type-check porque é regra de banco, não de
-- TypeScript: só um teste que INSERE uma compra encontra.
--
-- Correções:
--   1) os 3 inserts declaram `produto` e usam o conflict target certo. O card
--      segue nascendo em 'HM'; quem o move para AURUM/ETHB continua sendo o
--      trigger trg_zzz_hm_produto_por_oferta.
--   2) os lookups de card passam a usar `cs.fn_hm_card_da_oferta(comprador,
--      oferta)` — a função que a própria 0163 criou para escolher o card certo
--      quando a pessoa tem card em mais de um board. O `select id into` sem
--      desempate pegava um qualquer, e daí saíam interações e mudanças de
--      estágio no card errado.
--
-- Teste (transação revertida, 10/08 21h): venda de R$697 na rlgjsrul →
-- card criado, estágio "Contato Inicial", categoria 'sinal', turma T40, board HM,
-- tags [HT30 - 10-08 | Lead novo], pacote R$ 15.000, pago R$ 697,
-- saldo a perseguir R$ 14.303,00, 1 pagamento no razão.

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

  -- O SILÊNCIO CONHECIDO: oferta fora do catálogo não vira card, não vira
  -- pagamento e não alerta. Toda oferta nova precisa entrar em
  -- public.hm_product_catalog ANTES da venda (ver 0157).
  if v_cat is null then
    return new;
  end if;

  v_quando := coalesce(new.data_aprovacao, new.data_compra, now());
  v_turma  := cs.fn_hm_turma_por_data(coalesce(new.data_compra, new.data_aprovacao, now()));
  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

  if new.oferta_codigo = '6qxsk9kq' and v_quando >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, apto_ativacao)
    values (v_comprador, 'HM', v_pend, v_turma, coalesce(v_notes,'Acesso ETHB'), v_cat, true)
    on conflict (comprador_id, produto) do update
      set apto_ativacao = true, atualizado_em = now();

    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema',
              'Entrou na esteira HM (renovação de acesso ETHB — 6qxsk9kq — direto para Pendente de Liberação)', 'sistema');
    end if;

    begin
      perform cs.fn_tag_hm_origem(v_comprador);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;
    return new;
  end if;

  if v_cat in ('sinal','compra_cheia') and v_quando >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada)
    values (v_comprador, 'HM', v_ini, v_turma, v_notes, v_cat)
    on conflict (comprador_id, produto) do update
      set plano = coalesce(cs.contatos_hm.plano, excluded.plano),
          categoria_entrada = coalesce(cs.contatos_hm.categoria_entrada, excluded.categoria_entrada),
          atualizado_em = now();

    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);
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
    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);

    if v_id is null and v_quando >= v_cutoff then
      insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, apto_ativacao, pagamento_em)
      values (v_comprador, 'HM', v_pend, v_turma, coalesce(v_notes, 'saldo'), 'diferenca', true, v_quando)
      on conflict (comprador_id, produto) do nothing;

      v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);

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
