-- 0197_vazamento_entre_boards.sql
-- (aplicada em produção em 4 passos, 11/08 21:3x — consolidada aqui)
--
-- O teste de venda revertida da 0196 provou que o dinheiro AINDA vazava entre HM e
-- AURUM. Cada função abaixo decidia por `comprador_id`, sem olhar o produto do card.
-- Todas foram encontradas pelo mesmo teste: pagar no AURUM e conferir se o HM se mexe.
--
--   [1] fn_hm_provisionar_aluno    gravava valor_total/valor_pago em TODOS os cards
--                                  → cravou 13.072,68 (crédito de HM) como pacote do
--                                    card AURUM; pacote cravado vence a regra e o
--                                    board passou a mostrar 2.072,68 em vez de 35.927,32
--   [2] fn_hm_tem_lastro           compra do AURUM dava "lastro" ao HM
--   [3] fn_hm_valores_derivados    somava as compras dos dois boards
--                                  → [2]+[3]: saldo do HM do Eduardo pulou de
--                                    13.330,14 para 14.700,00 quando ele pagou no AURUM
--                                    (o pacote foi rederivado para 15.000 e o crédito
--                                    pró-rata sumiu)
--   [4] fn_hm_prorata              lia `where comprador_id` sem produto nem limit
--   [5] fn_hm_cancelar             cancelava TODOS os cards da pessoa
--                                  → reembolso do AURUM mandava o card do HM para
--                                    "Reclamada"
--   [6] fn_hm_produto_da_oferta    o fallback exigia compra APROVADA; no reembolso o
--                                  status muda, a oferta "perdia" o produto e voltava
--                                  a resolver como HM — o cancelamento ia para o board
--                                  errado justamente no evento de cancelamento
--   [7] fn_hm_card_da_oferta       escolhia o card comparando com a tabela de CANAL;
--                                  oferta sem canal → nenhum card casa → cai no mais
--                                  antigo (o do HM). O pagamento do SALDO DO AURUM
--                                  caiu no card do HM e o moveu para "Pendente de
--                                  Liberação"
--
-- Teste final (transação revertida), pessoa com card nos dois boards:
--   · paga 7.000 de saldo no AURUM → HM intacto (saldo 13.330,14, etapa e valor_pago
--     iguais); AURUM 59.000 → 52.000, vai para "Pendente de Liberação"
--   · reembolso dessa compra → só o card do AURUM vai para "Reclamada"; HM intacto
--   · SUBSCRIPTION_CANCELLATION (sem transação) com 2 cards → não cancela nada e abre
--     alerta `cancelamento_ambiguo`
--
-- As assinaturas ganharam parâmetro com DEFAULT ('HM' / null), então todos os callers
-- antigos seguem válidos.

-- [6] produto da oferta independe do status da compra
create or replace function cs.fn_hm_produto_da_oferta(p_oferta text, p_produto_id text default null)
 returns text language sql stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select coalesce(
    (select o.produto from cs.hm_origem_por_oferta o
      where o.oferta_codigo = p_oferta and o.produto is not null
      order by o.vale_de desc nulls last limit 1),
    (select m.produto from cs.hm_produto_hotmart m where m.produto_id = p_produto_id),
    (select m.produto from public.compras c
       join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
      where c.oferta_codigo = p_oferta
      order by coalesce(c.data_aprovacao, c.data_compra) desc nulls last limit 1),
    'HM');
$function$;

create or replace function cs.fn_hm_pagamento_do_produto(p_oferta text, p_produto text)
 returns boolean language sql stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select cs.fn_hm_produto_da_oferta(p_oferta, null) = coalesce(p_produto, 'HM');
$function$;

-- [7] o card que recebe o pagamento é o do produto resolvido
create or replace function cs.fn_hm_card_da_oferta(p_comprador uuid, p_oferta text)
returns uuid language sql stable
set search_path to 'cs','public','pg_temp'
as $function$
  select ch.id
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador
   order by
     (coalesce(ch.produto,'HM') = cs.fn_hm_produto_da_oferta(p_oferta, null)) desc,
     ch.criado_em asc
   limit 1;
$function$;

-- [2] lastro por produto
create or replace function cs.fn_hm_tem_lastro(p_comprador_id uuid, p_produto text default 'HM')
 returns boolean language sql stable security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  with entrada as (
    select min(coalesce(c.data_compra, c.data_aprovacao)) as em
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria = 'sinal'
       and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto)
  )
  select exists (
    select 1
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      left join entrada e on true
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto)
       and (
         cat.categoria = 'diferenca'
         or (cat.categoria = 'compra_cheia' and (
              (e.em is not null and coalesce(c.data_compra, c.data_aprovacao) > e.em)
              or (e.em is null and coalesce(c.data_compra, c.data_aprovacao) >= '2026-06-01')
            ))
       ));
$function$;

-- [3] valores derivados por produto
create or replace function cs.fn_hm_valores_derivados(p_comprador_id uuid, p_produto text default 'HM')
 returns table(valor_total numeric, valor_pago numeric, ambiguo boolean)
 language plpgsql stable security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_soma numeric := 0; v_cheia numeric := 0;
  v_tem_sinal boolean := false; v_installments boolean := false;
  v_saldo_nominal numeric; v_saldo_recorrente boolean := false;
  v_total numeric; v_pago numeric;
  v_entrada_valor numeric; v_entrada_pacote numeric;
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
     and cat.categoria in ('sinal','compra_cheia','diferenca')
     and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto);

  select round(c.preco), cat.pacote_cheio
    into v_entrada_valor, v_entrada_pacote
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria = 'sinal'
     and cat.pacote_cheio is not null
     and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto)
   order by coalesce(c.data_aprovacao, c.data_compra) asc, c.oferta_codigo asc, c.id asc
   limit 1;

  select os.valor, os.recorrente into v_saldo_nominal, v_saldo_recorrente
    from public.compras c
    join cs.hm_ofertas_saldo os on os.codigo = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto)
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_tem_sinal and v_saldo_nominal is not null then
    v_total := coalesce(v_entrada_valor, 300) + v_saldo_nominal;
  elsif v_tem_sinal then
    v_total := coalesce(v_entrada_pacote, 15000::numeric);
  elsif v_installments and v_cheia < 15000 then
    v_total := 15000::numeric;
  else
    v_total := v_cheia;
  end if;

  v_pago := least(v_soma, v_total);
  if v_total - v_pago < 1 then v_pago := v_total; end if;

  return query select v_total, v_pago,
    (v_installments or (v_saldo_recorrente and v_pago < v_total) or v_pago < v_total);
end$function$;

-- [4] pró-rata é conceito do HM: um card, o do HM
create or replace function cs.fn_hm_prorata(p_comprador_id uuid)
 returns table(dias_usados integer, dias_restantes integer, valor_dia numeric, consumido numeric, credito numeric, saldo_a_pagar numeric)
 language sql stable security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select
    d.usados,
    greatest(ch.credito_dias_totais - d.usados, 0),
    round(ch.credito_valor_pago / nullif(ch.credito_dias_totais, 0), 2),
    round(ch.credito_valor_pago * least(d.usados, ch.credito_dias_totais)::numeric / nullif(ch.credito_dias_totais, 0), 2),
    round(ch.credito_valor_pago * greatest(ch.credito_dias_totais - d.usados, 0)::numeric / nullif(ch.credito_dias_totais, 0), 2),
    round(14700 - (ch.credito_valor_pago * greatest(ch.credito_dias_totais - d.usados, 0)::numeric / nullif(ch.credito_dias_totais, 0)), 2)
  from cs.contatos_hm ch
  cross join lateral (select greatest((current_date - ch.credito_compra_em), 0) as usados) d
  where ch.comprador_id = p_comprador_id
    and coalesce(ch.produto, 'HM') = 'HM'
    and ch.credito_valor_pago is not null and ch.credito_compra_em is not null
  order by ch.criado_em asc
  limit 1;
$function$;

-- [5] cancelar só o board pedido; a matrícula na base THB é do HM
create or replace function cs.fn_hm_cancelar(p_comprador_id uuid, p_motivo text default null, p_origem text default 'manual', p_produto text default null)
 returns text language plpgsql security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aluno_id uuid;
  v_motivo   text;
begin
  select ch.aluno_id into v_aluno_id
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador_id
     and (p_produto is null or coalesce(ch.produto,'HM') = p_produto)
   order by (coalesce(ch.produto,'HM') = 'HM') desc, ch.criado_em asc
   limit 1;

  update cs.contatos_hm
     set cancelamento_em           = coalesce(cancelamento_em, now()),
         cancelamento_efetivado_em = coalesce(cancelamento_efetivado_em, now()),
         cancelamento_origem       = coalesce(cancelamento_origem, p_origem),
         cancelamento_motivo       = coalesce(nullif(p_motivo, ''), cancelamento_motivo),
         atualizado_em             = now()
   where comprador_id = p_comprador_id
     and (p_produto is null or coalesce(produto,'HM') = p_produto);

  if v_aluno_id is null then return 'sem_aluno'; end if;
  if p_produto is not null and p_produto <> 'HM' then
    return 'cancelado';
  end if;

  v_motivo := coalesce(nullif(p_motivo, ''), 'Cancelamento do Holding Masters');

  update public.thb_alunos a
     set cancelado_em         = coalesce(a.cancelado_em, now()),
         cancelado_motivo     = coalesce(a.cancelado_motivo, v_motivo),
         cancelado_origem     = coalesce(a.cancelado_origem, p_origem),
         situacao_financeira  = 'cancelado',
         status_pagamento     = 'Cancelado',
         retornou_em          = null,
         atualizado_em        = now()
   where a.id = v_aluno_id
      or (a.socio_de_aluno_id = v_aluno_id and a.fonte = 'sip_ativacao_hm');

  return 'cancelado';
end$function$;

create or replace function cs.fn_hm_compra_cancelada()
 returns trigger language plpgsql security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_dono uuid; v_card_id uuid; v_produto text; v_est_ant smallint;
  v_est_cancel smallint; v_motivo text;
begin
  begin
    v_dono := cs.fn_hm_dono_do_pagamento(new.comprador_id);

    select ch.id, ch.estagio_id, ch.produto
      into v_card_id, v_est_ant, v_produto
      from cs.contatos_hm ch
     where ch.comprador_id = v_dono
       and cs.fn_hm_pagamento_do_produto(new.oferta_codigo, ch.produto)
     order by (ch.produto = 'HM') desc, ch.criado_em asc
     limit 1;

    if v_card_id is null then return new; end if;

    v_motivo := 'Cancelado na Hotmart (' || coalesce(new.hotmart_event, new.status) || ')';
    perform cs.fn_hm_cancelar(v_dono, v_motivo, 'hotmart', coalesce(v_produto,'HM'));

    update cs.contatos_hm
       set hotmart_cancelado_em           = coalesce(hotmart_cancelado_em, now()),
           hotmart_cancelamento_evento    = coalesce(new.hotmart_event, new.status),
           hotmart_cancelamento_transacao = new.hotmart_transaction,
           atualizado_em                  = now()
     where id = v_card_id;

    select id into v_est_cancel from cs.estagios where chave='hm_cancelamento' and evento='HM';
    if v_est_cancel is not null and v_est_ant is distinct from v_est_cancel then
      update cs.contatos_hm set estagio_id = v_est_cancel, atualizado_em = now() where id = v_card_id;
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
      values (v_card_id, 'mudanca_estagio',
              'Movido para "Solicitou Cancelamento" pelo cancelamento na Hotmart ('||coalesce(v_produto,'?')||')',
              'hotmart', v_est_ant, v_est_cancel);
    end if;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card_id, 'sistema', v_motivo || ' — board '||coalesce(v_produto,'?')||'. Remover os acessos desse produto.', 'hotmart');
  exception when others then
    null;
  end;
  return new;
end$function$;

-- [1] provisionar aluno não crava dinheiro em card de outro board
--     (corpo idêntico ao anterior, exceto o UPDATE final e o LIMIT na turma de origem)
create or replace function cs.fn_hm_provisionar_aluno(p_comprador_id uuid, p_valor_total numeric, p_valor_pago numeric)
 returns uuid language plpgsql security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_cp public.compradores%rowtype;
  v_aluno public.thb_alunos%rowtype;
  v_aluno_id uuid; v_turma_atual smallint; v_turma_orig smallint; v_turma_final smallint;
  v_codigo text; v_data_compra timestamptz;
  v_total numeric := coalesce(p_valor_total, 0);
  v_pago numeric := coalesce(p_valor_pago, 0);
  v_saldo numeric; v_situacao text; v_status text;
  v_ja_tinha boolean := false; v_eh_renov boolean := false;
  v_regra text; v_expira date;
begin
  select * into v_cp from public.compradores where id = p_comprador_id;
  if not found then return null; end if;

  select id into v_turma_atual from public.thb_turmas where codigo = cs.fn_hm_turma_atual() limit 1;

  select t.id into v_turma_orig
    from cs.contatos_hm ch join public.thb_turmas t on t.codigo = ch.turma_origem
   where ch.comprador_id = p_comprador_id
   order by (ch.produto = 'HM') desc, ch.criado_em asc
   limit 1;

  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra
    from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia');
  v_data_compra := coalesce(v_data_compra, now());

  select exists(
    select 1 from public.compras c
     where c.comprador_id = p_comprador_id and c.produto_id = '3507214'
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
  ) into v_eh_renov;

  v_expira := (v_data_compra + interval '365 days')::date;
  v_regra  := case when v_eh_renov then 'Renovação HM + 365 dias' else 'Compra HM + 365 dias' end;

  v_saldo := greatest(v_total - v_pago, 0);
  if v_total > 0 and v_saldo = 0 then v_situacao := 'quitado'; v_status := 'Quitado';
  elsif v_pago > 0 then v_situacao := 'em_andamento'; v_status := 'Em andamento';
  else v_situacao := 'so_sinal'; v_status := 'Só sinal pago'; end if;

  select * into v_aluno from public.thb_alunos where comprador_id = p_comprador_id limit 1;
  if not found and coalesce(trim(v_cp.email), '') <> '' then
    select * into v_aluno from public.thb_alunos where lower(trim(email)) = lower(trim(v_cp.email)) limit 1;
  end if;
  v_aluno_id := v_aluno.id;

  v_ja_tinha := v_aluno_id is not null and v_aluno.data_expiracao is not null
                and v_aluno.data_expiracao >= current_date;

  if v_aluno_id is null then
    v_turma_final := coalesce(v_turma_orig, v_turma_atual);
    insert into public.thb_alunos (
      nome, email, telefone, documento, tipo_documento, plano, turma_id, comprador_id,
      data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
      valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
      ultimo_pagamento, fonte
    ) values (
      v_cp.nome, v_cp.email, v_cp.telefone, v_cp.documento, v_cp.tipo_documento, 'aluno',
      v_turma_final, p_comprador_id,
      v_data_compra, v_expira, 'Hotmart (THB)',
      v_regra, '1 ano', v_total, v_pago, v_saldo, v_situacao, v_status,
      current_date, 'sip_ativacao_hm'
    ) returning id into v_aluno_id;
  else
    v_turma_final := coalesce(v_turma_orig, v_aluno.turma_id, v_turma_atual);
    update public.thb_alunos set
      comprador_id = coalesce(comprador_id, p_comprador_id),
      turma_id = v_turma_final,
      data_expiracao = greatest(coalesce(data_expiracao, current_date), v_expira),
      regra_acesso = v_regra, tempo_acesso = '1 ano',
      telefone = coalesce(telefone, v_cp.telefone), documento = coalesce(documento, v_cp.documento),
      valor_total = v_total, valor_pago = v_pago, saldo_devedor = v_saldo,
      situacao_financeira = v_situacao, status_pagamento = v_status,
      ultimo_pagamento = current_date, atualizado_em = now()
    where id = v_aluno_id;
  end if;

  select codigo into v_codigo from public.thb_turmas where id = v_turma_final;

  update cs.contatos_hm
     set aluno_id = v_aluno_id,
         valor_total = case when coalesce(produto,'HM') = 'HM' then v_total else valor_total end,
         valor_pago  = case when coalesce(produto,'HM') = 'HM' then v_pago  else valor_pago  end,
         acesso_preexistente = acesso_preexistente or v_ja_tinha,
         turma = coalesce(v_codigo, turma, cs.fn_hm_turma_atual()),
         tags = (select coalesce(array_agg(distinct t), '{}')
                   from unnest(array(select x from unnest(coalesce(tags, '{}')) x where x !~ '^Turma ')
                        || array['Turma ' || coalesce(v_codigo, cs.fn_hm_turma_atual())]) t),
         atualizado_em = now()
   where comprador_id = p_comprador_id;

  return v_aluno_id;
end$function$;

-- recálculo financeiro passando o produto adiante
create or replace function cs.fn_hm_recalcular_financeiro(p_comprador_id uuid)
 returns void language plpgsql security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_card cs.contatos_hm%rowtype;
  v_pago numeric; v_total numeric; v_saldo numeric;
  v_ultimo timestamptz; v_val record; v_situacao text; v_status text;
begin
  for v_card in
    select * from cs.contatos_hm
     where comprador_id = p_comprador_id
     order by (produto = 'HM') desc, criado_em asc
  loop
    select coalesce(sum(p.valor), 0), max(p.pago_em)
      into v_pago, v_ultimo
      from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, v_card.produto);

    v_total := v_card.valor_total;

    if coalesce(v_card.produto, 'HM') = 'HM' then
      if v_total is null and cs.fn_hm_tem_lastro(p_comprador_id, 'HM') then
        select * into v_val from cs.fn_hm_valores_derivados(p_comprador_id, 'HM');
        v_total := v_val.valor_total;
      end if;
      v_saldo := greatest(coalesce(v_total, 0) - v_pago, 0);
      if v_saldo < 1 then v_saldo := 0; end if;
    else
      v_saldo := cs.fn_aurum_saldo(p_comprador_id);
      if v_saldo is not null and v_saldo < 1 then v_saldo := 0; end if;
    end if;

    update cs.contatos_hm
       set valor_pago = v_pago,
           valor_total = v_total,
           quitado_em = case
                          when coalesce(v_card.produto,'HM') = 'HM'
                            then case when coalesce(v_total, 0) > 0 and v_saldo = 0
                                      then coalesce(quitado_em, v_ultimo, now()) else null end
                          else case when v_saldo = 0 and v_pago > 0
                                    then coalesce(quitado_em, v_ultimo, now()) else null end
                        end,
           atualizado_em = now()
     where id = v_card.id;

    if v_card.aluno_id is not null and coalesce(v_card.produto,'HM') = 'HM' then
      if coalesce(v_total, 0) > 0 and coalesce(v_saldo, 1) = 0 then v_situacao := 'quitado'; v_status := 'Quitado';
      elsif v_pago > 0 then v_situacao := 'em_andamento'; v_status := 'Em andamento';
      else v_situacao := 'so_sinal'; v_status := 'Só sinal pago'; end if;

      update public.thb_alunos
         set valor_total = v_total, valor_pago = v_pago, saldo_devedor = coalesce(v_saldo, 0),
             situacao_financeira = case when situacao_financeira = 'cancelado'
                                        then situacao_financeira else v_situacao end,
             status_pagamento    = case when situacao_financeira = 'cancelado'
                                        then status_pagamento else v_status end,
             ultimo_pagamento = coalesce(v_ultimo::date, ultimo_pagamento),
             atualizado_em = now()
       where id = v_card.aluno_id;
    end if;
  end loop;
end$function$;
