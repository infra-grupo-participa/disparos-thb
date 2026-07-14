-- =====================================================================
-- 0076_hm_lancar_pagamento
--
-- A porta de entrada do razão para quem NÃO é a Hotmart: o importador do CSV, o
-- acerto manual (PIX na conta, transferência, dinheiro combinado por fora) e o
-- estorno de um lançamento errado.
--
-- Por que uma função e não um INSERT: o papel da aplicação (`disparos_app`) tem
-- só SELECT em cs.hm_pagamentos. Dinheiro entra por uma porta com nome, regra e
-- autor — nunca por um INSERT solto vindo da web.
--
-- A REGRA QUE ESTA FUNÇÃO GUARDA: pagamento de quem não está no kanban é recusado.
-- Não se cria card a partir de um CSV. Se a pessoa não está no funil, o pagamento
-- dela não é problema do HM (aparece em cs.vw_hm_pagamentos_orfaos).
--
-- Aditiva e idempotente.
-- =====================================================================

create or replace function cs.fn_hm_lancar_pagamento(
  p_comprador_id uuid,
  p_categoria    text,
  p_valor        numeric,
  p_pago_em      timestamptz,
  p_origem       text default 'manual',
  p_transacao    text default null,
  p_oferta       text default null,
  p_metodo       text default null,
  p_parcela      smallint default null,
  p_obs          text default null,
  p_autor        text default 'sistema'
)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  if p_comprador_id is null or coalesce(p_valor, 0) = 0 or p_pago_em is null then
    raise exception 'Lançamento inválido: comprador, valor e data são obrigatórios';
  end if;

  -- Sem card, sem lançamento. O razão do HM é dos que estão no funil do HM.
  if not exists (select 1 from cs.contatos_hm where comprador_id = p_comprador_id) then
    raise exception 'Comprador % não está no kanban do HM — pagamento não lançado', p_comprador_id
      using errcode = 'no_data_found';
  end if;

  insert into cs.hm_pagamentos (comprador_id, categoria, valor, pago_em, origem, transacao,
                                oferta_codigo, metodo_pagamento, parcela, obs, autor)
  values (p_comprador_id, p_categoria, round(p_valor, 2), p_pago_em, p_origem, p_transacao,
          p_oferta, p_metodo, p_parcela, p_obs, coalesce(p_autor, 'sistema'))
  -- Idempotência: reimportar o mesmo CSV não duplica um centavo.
  on conflict (transacao) where transacao is not null do nothing
  returning id into v_id;

  return v_id;   -- null = já existia (nada a fazer)
end$fn$;

grant execute on function cs.fn_hm_lancar_pagamento(uuid, text, numeric, timestamptz, text, text, text, text, smallint, text, text) to disparos_app;

-- Estorno: erro de digitação some, pagamento de verdade nunca é apagado às escuras.
-- O lançamento sai do razão e a interação registra quem tirou e por quê — o saldo
-- se recompõe sozinho pelo gatilho de recálculo.
create or replace function cs.fn_hm_estornar_pagamento(
  p_pagamento_id uuid,
  p_motivo       text,
  p_autor        text default 'sistema'
)
returns boolean
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_p    cs.hm_pagamentos%rowtype;
  v_card uuid;
begin
  select * into v_p from cs.hm_pagamentos where id = p_pagamento_id;
  if not found then return false; end if;

  select id into v_card from cs.contatos_hm where comprador_id = v_p.comprador_id;

  delete from cs.hm_pagamentos where id = p_pagamento_id;   -- o gatilho recalcula o saldo

  if v_card is not null then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card, 'sistema',
            'Pagamento estornado: R$ ' || trim(to_char(v_p.valor, '999G999G999D99'))
            || ' (' || v_p.categoria || ', ' || v_p.origem || ')'
            || case when v_p.transacao is not null then ' — transação ' || v_p.transacao else '' end
            || ' · motivo: ' || coalesce(p_motivo, 'não informado'),
            coalesce(p_autor, 'sistema'));
  end if;

  return true;
end$fn$;

grant execute on function cs.fn_hm_estornar_pagamento(uuid, text, text) to disparos_app;

-- O extrato de uma pessoa, pronto para a ficha (drawer): lançamentos do mais novo
-- para o mais velho, com o saldo corrente depois de cada um.
create or replace function cs.fn_hm_extrato(p_comprador_id uuid)
returns table (
  id uuid, categoria text, valor numeric, pago_em timestamptz, origem text,
  transacao text, oferta_codigo text, metodo_pagamento text, parcela smallint,
  obs text, autor text, acumulado numeric, saldo_depois numeric
)
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  with total as (
    select coalesce(valor_total, 0) as valor_total
      from cs.contatos_hm where comprador_id = p_comprador_id
  ),
  ext as (
    select p.id, p.categoria, p.valor, p.pago_em, p.origem, p.transacao, p.oferta_codigo,
           p.metodo_pagamento, p.parcela, p.obs, p.autor,
           sum(p.valor) over (order by p.pago_em, p.criado_em
                              rows between unbounded preceding and current row) as acumulado
      from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
  )
  select ext.id, ext.categoria, ext.valor, ext.pago_em, ext.origem, ext.transacao,
         ext.oferta_codigo, ext.metodo_pagamento, ext.parcela, ext.obs, ext.autor,
         ext.acumulado,
         case when total.valor_total > 0
              then greatest(total.valor_total - ext.acumulado, 0)
              else null end as saldo_depois     -- sem total fechado, não se afirma saldo
    from ext cross join total
   order by ext.pago_em desc, ext.acumulado desc;
$fn$;

grant execute on function cs.fn_hm_extrato(uuid) to disparos_app;
