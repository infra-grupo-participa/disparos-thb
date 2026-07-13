-- =====================================================================
-- 0050_hm_compra_cheia_vai_para_ativacao
-- Quem compra o valor CHEIO não tem nada a tratar com o comercial: o card vai
-- direto para a Ativação ("Pendente de Liberação"), como já acontece com quem
-- paga o sinal e depois quita o saldo. Se o aluno já existir na base mestre, é
-- atualizado (cs.fn_hm_provisionar_aluno faz upsert).
--
-- RECORTE QUE IMPORTA — só compra cheia a partir do cutoff da T39 (25/06/2026).
-- O catálogo marca como 'compra_cheia' qualquer compra integral do HM, inclusive
-- as de turmas ANTIGAS (Áurea 03/2026, Pedro 04/2026, Naiara 15/06). Essas
-- pessoas são ex-alunos que agora pagaram o sinal de R$300 e estão sendo
-- trabalhadas pelo comercial para migrar — mandá-las para a Ativação seria
-- afirmar que compraram a T39, o que não é verdade. O cutoff já existia no
-- gatilho para decidir quem vira card; aqui ele decide quem já entra pago.
--
-- Financeiro do boleto parcelado (HOTMART_INSTALLMENTS): a Hotmart grava o valor
-- da PARCELA em compras.preco (Marina: 1.276,14 — uma de 12). Sem tratamento, o
-- aluno nasceria "quitado por R$ 1.276,14". Passa a valer o preço de lista do
-- pacote (15.000) como total, com o cadastro marcado para conferência humana —
-- o número exato do contrato o sistema não tem como saber.
-- Aditiva e idempotente.
-- =====================================================================

-- 1) Valores derivados: compra cheia parcelada não é compra cheia quitada -----
create or replace function cs.fn_hm_valores_derivados(p_comprador_id uuid)
returns table (valor_total numeric, valor_pago numeric, ambiguo boolean)
language plpgsql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_soma         numeric := 0;
  v_cheia        numeric := 0;
  v_tem_sinal    boolean := false;
  v_installments boolean := false;
  v_saldo_nominal numeric;
  v_saldo_recorrente boolean := false;
  v_total        numeric;
  v_pago         numeric;
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

  -- A oferta de saldo carrega o desconto do pró-rata (ver 0049): quem pagou
  -- ikgazdy8 (12.772,68) quitou — o pacote dele é 300 + 12.772,68, não 15.000.
  select os.valor, os.recorrente into v_saldo_nominal, v_saldo_recorrente
    from public.compras c
    join cs.hm_ofertas_saldo os on os.codigo = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_tem_sinal and v_saldo_nominal is not null then
    v_total := 300 + v_saldo_nominal;
  elsif v_tem_sinal then
    v_total := 15000::numeric;            -- ainda não quitou o saldo
  elsif v_installments and v_cheia < 15000 then
    v_total := 15000::numeric;            -- compra cheia no boleto: preco é a parcela
  else
    v_total := v_cheia;
  end if;

  v_pago := least(v_soma, v_total);
  if v_total - v_pago < 1 then v_pago := v_total; end if;   -- centavos não são dívida

  return query select
    v_total,
    v_pago,
    (v_installments or (v_saldo_recorrente and v_pago < v_total) or v_pago < v_total);
end$fn$;

-- 2) Gatilho de venda: compra cheia (pós-cutoff) entra já na Ativação ---------
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

  v_quando := coalesce(new.data_aprovacao, new.data_compra, now());
  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

  if v_cat in ('sinal','compra_cheia') and v_quando >= v_cutoff then
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

    -- Classificação de origem (público/evento/turma). Nunca derruba a compra.
    begin
      perform cs.fn_tag_hm_origem(new.comprador_id);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;

    -- Compra cheia QUITA a formação: o aluno nasce E o card pula o Comercial.
    -- Sinal sozinho não: fica como card na esteira até o saldo entrar.
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
          values (v_id, 'sistema', 'Aluno criado/atualizado na base THB (compra cheia)', 'sistema');
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

-- 3) Backfill: compras cheias pós-cutoff que ficaram presas no Comercial ------
do $backfill$
declare
  r       record;
  v_val   record;
  v_aluno uuid;
  v_pend  smallint;
begin
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

  for r in
    select ch.id as card_id, ch.comprador_id, ch.estagio_id, ch.aluno_id,
           max(coalesce(c.data_aprovacao, c.data_compra)) as pago_em
      from cs.contatos_hm ch
      join cs.estagios e on e.id = ch.estagio_id and e.aba = 'comercial'
      join public.compras c on c.comprador_id = ch.comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where cat.categoria = 'compra_cheia'
       and coalesce(c.data_aprovacao, c.data_compra) >= '2026-06-25 00:00:00+00'
     group by ch.id, ch.comprador_id, ch.estagio_id, ch.aluno_id
  loop
    update cs.contatos_hm
       set estagio_id = v_pend, apto_ativacao = true,
           pagamento_em = coalesce(pagamento_em, r.pago_em), atualizado_em = now()
     where id = r.card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (r.card_id, 'mudanca_estagio',
            'Compra cheia reconhecida no reprocessamento — movido para "Pendente de Liberação"',
            'sistema', r.estagio_id, v_pend);

    begin
      select * into v_val from cs.fn_hm_valores_derivados(r.comprador_id);
      v_aluno := cs.fn_hm_provisionar_aluno(r.comprador_id, v_val.valor_total, v_val.valor_pago);
      if v_aluno is not null then
        if v_val.ambiguo then
          update public.thb_alunos
             set tratamento_manual = coalesce(tratamento_manual,
                   'Financeiro a conferir — compra cheia parcelada: compras.preco guarda a parcela, não o total do contrato')
           where id = v_aluno;
        end if;
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (r.card_id, 'sistema', 'Aluno criado/atualizado na base THB no reprocessamento (migration 0050)', 'sistema');
      end if;
    exception when others then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (r.card_id, 'sistema', 'Falha ao criar o aluno na base THB no reprocessamento ('||sqlerrm||')', 'sistema');
    end;
  end loop;
end$backfill$;

-- 4) Coerência dos cards que alguém já tinha arrastado à mão ------------------
-- Card na Ativação com compra cheia paga, mas sem `apto_ativacao`: o operador
-- moveu na frente do sistema (foi o caso da Laura, que pagou o sinal e a compra
-- cheia no mesmo dia). Sem a flag, o card não mostra "pago" e um arrasto de volta
-- ao Comercial não limparia o pagamento — o estado ficaria mentindo.
update cs.contatos_hm ch
   set apto_ativacao = true,
       pagamento_em = coalesce(ch.pagamento_em, x.pago_em),
       atualizado_em = now()
  from (
    select c.comprador_id, max(coalesce(c.data_aprovacao, c.data_compra)) as pago_em
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria = 'compra_cheia'
       and coalesce(c.data_aprovacao, c.data_compra) >= '2026-06-25 00:00:00+00'
     group by c.comprador_id
  ) x
  join cs.estagios e2 on true
 where ch.comprador_id = x.comprador_id
   and e2.id = ch.estagio_id and e2.aba = 'ativacao'
   and not ch.apto_ativacao;
