-- =====================================================================
-- 0055_hm_aluno_da_base_mantem_turma
-- Duas populações, dois destinos (regra do time):
--
--   • ALUNO NOVO — pagou o sinal, não é da base. Ao quitar/parcelar os 14.700,
--     vira aluno da TURMA ATUAL (T39) e recebe 1 ano de acesso.
--   • ALUNO DA BASE (THB/Aurum) — já é aluno. A oferta dele é proporcional ao
--     tempo que sobrou do acesso vigente (o crédito pró-rata embutido no valor
--     da oferta de saldo). Ao pagar, ele MANTÉM A TURMA DELE e tem o acesso
--     RENOVADO por mais um ano.
--
-- O provisionamento (0043) fazia `turma_id = T39` para todo mundo: 13 alunos da
-- base perderam a turma (Tomé T29, Eder T6, Sérgio T34, Marina T38…) e, pior,
-- NÃO tiveram o acesso renovado — o update nunca tocava em `data_expiracao`.
-- Ricardo Buss quitou e continuava com validade 06/07/2026, já vencida.
--
-- Sobre a renovação: 1 ano contado a partir do PAGAMENTO, não do vencimento
-- antigo. É o que a matemática da oferta já assume — o tempo que restava foi
-- devolvido a ele como desconto (o pró-rata), então o ciclo recomeça do zero.
--
-- A turma de origem sai de `cs.contatos_hm.turma_origem`, congelada na entrada
-- do funil (0053) justamente porque a base é reescrita pelo provisionamento.
-- Aditiva e idempotente.
-- =====================================================================

create or replace function cs.fn_hm_provisionar_aluno(
  p_comprador_id uuid,
  p_valor_total  numeric,
  p_valor_pago   numeric
)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_cp          public.compradores%rowtype;
  v_aluno_id    uuid;
  v_turma_t39   smallint;
  v_turma_orig  smallint;
  v_data_compra timestamptz;
  v_total       numeric := coalesce(p_valor_total, 0);
  v_pago        numeric := coalesce(p_valor_pago, 0);
  v_saldo       numeric;
  v_situacao    text;
  v_status      text;
  v_pago_em     timestamptz;
begin
  select * into v_cp from public.compradores where id = p_comprador_id;
  if not found then return null; end if;

  select id into v_turma_t39 from public.thb_turmas where codigo = 'T39' limit 1;

  -- A turma de origem (congelada no card) é o que separa as duas populações:
  -- quem tem uma é aluno da base e a mantém; quem não tem é lead novo e entra na T39.
  select t.id into v_turma_orig
    from cs.contatos_hm ch
    join public.thb_turmas t on t.codigo = ch.turma_origem
   where ch.comprador_id = p_comprador_id;

  -- Data da matrícula/pagamento = a compra de entrada no HM.
  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia');
  v_data_compra := coalesce(v_data_compra, now());

  -- Quando o acesso passa a valer: a quitação (ou a compra cheia). É dela que
  -- conta o ano novo — não da data do sinal, que pode ser semanas antes.
  select max(coalesce(c.data_aprovacao, c.data_compra)) into v_pago_em
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('diferenca','compra_cheia');
  v_pago_em := coalesce(v_pago_em, now());

  v_saldo := greatest(v_total - v_pago, 0);
  if v_total > 0 and v_saldo = 0 then
    v_situacao := 'quitado';      v_status := 'Quitado';
  elsif v_pago > 0 then
    v_situacao := 'em_andamento'; v_status := 'Em andamento';
  else
    v_situacao := 'so_sinal';     v_status := 'Só sinal pago';
  end if;

  select id into v_aluno_id from public.thb_alunos where comprador_id = p_comprador_id limit 1;
  if v_aluno_id is null and coalesce(trim(v_cp.email), '') <> '' then
    select id into v_aluno_id from public.thb_alunos
     where lower(trim(email)) = lower(trim(v_cp.email)) limit 1;
  end if;

  if v_aluno_id is null then
    -- ALUNO NOVO: nasce na turma atual (T39) com 1 ano de acesso.
    insert into public.thb_alunos (
      nome, email, telefone, documento, tipo_documento, plano, turma_id, comprador_id,
      data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
      valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
      ultimo_pagamento, fonte
    ) values (
      v_cp.nome, v_cp.email, v_cp.telefone, v_cp.documento, v_cp.tipo_documento, 'aluno',
      coalesce(v_turma_orig, v_turma_t39), p_comprador_id,
      v_data_compra, (v_pago_em + interval '365 days')::date, 'Hotmart (THB)',
      'Quitação + 365 dias', '1 ano',
      v_total, v_pago, v_saldo, v_situacao, v_status,
      current_date, 'sip_ativacao_hm'
    )
    returning id into v_aluno_id;
  else
    -- ALUNO DA BASE (ou recompra): MANTÉM a turma dele — a T39 é a turma de quem
    -- está entrando agora, não dele. E o acesso é RENOVADO por mais um ano.
    -- Nome e e-mail nunca são sobrescritos: a base mestre manda neles.
    update public.thb_alunos set
      comprador_id        = coalesce(comprador_id, p_comprador_id),
      turma_id            = coalesce(v_turma_orig, turma_id, v_turma_t39),
      data_expiracao      = (v_pago_em + interval '365 days')::date,
      regra_acesso        = 'Renovação HM + 365 dias',
      tempo_acesso        = '1 ano',
      telefone            = coalesce(telefone, v_cp.telefone),
      documento           = coalesce(documento, v_cp.documento),
      valor_total         = v_total,
      valor_pago          = v_pago,
      saldo_devedor       = v_saldo,
      situacao_financeira = v_situacao,
      status_pagamento    = v_status,
      ultimo_pagamento    = current_date,
      atualizado_em       = now()
    where id = v_aluno_id;
  end if;

  update cs.contatos_hm
     set aluno_id = v_aluno_id, valor_total = v_total, valor_pago = v_pago, atualizado_em = now()
   where comprador_id = p_comprador_id;

  return v_aluno_id;
end$fn$;

grant execute on function cs.fn_hm_provisionar_aluno(uuid, numeric, numeric) to disparos_app;

-- Backfill: devolve a turma e renova o acesso de quem já foi provisionado -----
update public.thb_alunos a
   set turma_id       = t.id,
       data_expiracao = (coalesce(ch.pagamento_em, now()) + interval '365 days')::date,
       regra_acesso   = 'Renovação HM + 365 dias',
       tempo_acesso   = '1 ano',
       atualizado_em  = now()
  from cs.contatos_hm ch
  join public.thb_turmas t on t.codigo = ch.turma_origem
 where a.id = ch.aluno_id
   and ch.turma_origem is not null
   and ch.aluno_id is not null;
