-- =====================================================================
-- 0043_cs_hm_provisiona_aluno
-- Automatiza a entrada do aluno HM na base mestre public.thb_alunos quando o
-- comercial confirma o pagamento do saldo — hoje isso é feito à mão (os 7
-- registros com fonte='webhook_hotmart_hm' foram inseridos manualmente).
--
-- Fluxo novo:
--   comercial confirma pagamento (forma + valores)
--     → card cai em "Pendente de Liberação" (0042)
--     → cs.fn_hm_provisionar_aluno cria/atualiza a linha em public.thb_alunos
--       com turma T39 e o bloco financeiro (total/pago/saldo/situação)
--   operador move o card para "Acesso Liberado"
--     → cs.fn_hm_liberar_acesso carimba status_acesso='vigente'
--
-- Separar as duas etapas é proposital: provisionar a linha na base é o INSUMO
-- que o GPS consome para criar o acesso; o acesso em si só existe depois que
-- alguém o cria de fato. Por isso a linha nasce com status_acesso nulo — igual
-- aos 7 registros que existem hoje.
--
-- public.thb_alunos tem RLS e o papel `disparos_app` não tem grant nela. Por
-- isso as funções são SECURITY DEFINER (mesmo padrão de cs.fn_tag_hm_origem),
-- com execute concedido ao app. Aditiva e idempotente.
-- =====================================================================

-- 1) Guarda de unicidade na base mestre --------------------------------------
-- A automação casa o aluno por comprador_id e, na falta dele, por e-mail. Sem
-- unicidade, uma corrida (dois cliques no "confirmar pagamento") duplicaria o
-- aluno. Hoje a base tem 0 duplicatas nos dois eixos — os índices só travam o
-- que já é verdade.
create unique index if not exists thb_alunos_comprador_uidx
  on public.thb_alunos (comprador_id) where comprador_id is not null;
create unique index if not exists thb_alunos_email_uidx
  on public.thb_alunos (lower(trim(email))) where email is not null and email <> '';

-- 2) Rastro no overlay do HM -------------------------------------------------
alter table cs.contatos_hm add column if not exists aluno_id    uuid references public.thb_alunos(id) on delete set null;
alter table cs.contatos_hm add column if not exists valor_total numeric;
alter table cs.contatos_hm add column if not exists valor_pago  numeric;

-- 3) Provisiona (cria ou atualiza) o aluno na base mestre ---------------------
-- Retorna o id do aluno, ou null se o comprador não existe.
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
  v_turma       smallint;
  v_data_compra timestamptz;
  v_total       numeric := coalesce(p_valor_total, 0);
  v_pago        numeric := coalesce(p_valor_pago, 0);
  v_saldo       numeric;
  v_situacao    text;
  v_status      text;
begin
  select * into v_cp from public.compradores where id = p_comprador_id;
  if not found then return null; end if;

  select id into v_turma from public.thb_turmas where codigo = 'T39' limit 1;

  -- Data da matrícula = primeira compra HM de entrada (sinal ou compra cheia).
  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia');
  v_data_compra := coalesce(v_data_compra, now());

  v_saldo := greatest(v_total - v_pago, 0);
  if v_total > 0 and v_saldo = 0 then
    v_situacao := 'quitado';      v_status := 'Quitado';
  elsif v_pago > 0 then
    v_situacao := 'em_andamento'; v_status := 'Em andamento';
  else
    v_situacao := 'so_sinal';     v_status := 'Só sinal pago';
  end if;

  -- Casamento: comprador_id é a chave forte; e-mail é o fallback (é como a
  -- base foi construída e como o GPS casa em fn_hm_fila).
  select id into v_aluno_id from public.thb_alunos where comprador_id = p_comprador_id limit 1;
  if v_aluno_id is null and coalesce(trim(v_cp.email), '') <> '' then
    select id into v_aluno_id from public.thb_alunos
     where lower(trim(email)) = lower(trim(v_cp.email)) limit 1;
  end if;

  if v_aluno_id is null then
    insert into public.thb_alunos (
      nome, email, telefone, documento, tipo_documento, plano, turma_id, comprador_id,
      data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
      valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
      ultimo_pagamento, fonte
    ) values (
      v_cp.nome, v_cp.email, v_cp.telefone, v_cp.documento, v_cp.tipo_documento, 'aluno', v_turma, p_comprador_id,
      v_data_compra, (v_data_compra + interval '365 days')::date, 'Hotmart (THB)', 'Compra + 365 dias', '1 ano',
      v_total, v_pago, v_saldo, v_situacao, v_status,
      current_date, 'sip_ativacao_hm'
    )
    returning id into v_aluno_id;
  else
    -- Aluno já existe (recompra). Vincula o comprador, move para a turma atual
    -- e sobrescreve o bloco financeiro. Nome/e-mail nunca são sobrescritos —
    -- a base mestre manda neles.
    update public.thb_alunos set
      comprador_id        = coalesce(comprador_id, p_comprador_id),
      turma_id            = v_turma,
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

-- 4) Marca o acesso como vigente (etapa "Acesso Liberado") --------------------
-- Retorna true se carimbou. Não provisiona: se o aluno ainda não existe na base
-- (card que pulou o pagamento), não há o que marcar.
create or replace function cs.fn_hm_liberar_acesso(p_comprador_id uuid)
returns boolean
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_aluno_id uuid;
begin
  select coalesce(ch.aluno_id, (select a.id from public.thb_alunos a where a.comprador_id = p_comprador_id limit 1))
    into v_aluno_id
    from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
  if v_aluno_id is null then return false; end if;

  update public.thb_alunos
     set status_acesso = 'vigente', atualizado_em = now()
   where id = v_aluno_id and status_acesso is distinct from 'vigente';

  update cs.contatos_hm set aluno_id = v_aluno_id where comprador_id = p_comprador_id and aluno_id is null;
  return true;
end$fn$;

grant execute on function cs.fn_hm_provisionar_aluno(uuid, numeric, numeric) to disparos_app;
grant execute on function cs.fn_hm_liberar_acesso(uuid) to disparos_app;
