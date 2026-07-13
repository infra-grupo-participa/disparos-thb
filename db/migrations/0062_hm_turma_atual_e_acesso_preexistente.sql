-- =====================================================================
-- 0060_hm_turma_atual_e_acesso_preexistente
--
-- 1) QUEM JÁ TEM ACESSO NÃO ENTRA NA FILA DE LIBERAÇÃO
--    Dienifer, Gustavo e Katia (Imersão POA) compraram o HM em junho e receberam
--    acesso na época — a base confirma: matrícula vigente até 2027. Mesmo assim o
--    card caiu em "Pendente de Liberação", como se alguém precisasse criar um
--    acesso que já existe. A esteira só pode pedir liberação de quem NÃO tem.
--
--    O provisionamento agora sabe distinguir: se o aluno JÁ EXISTIA na base com
--    matrícula válida, o acesso é pré-existente (ele só teve a validade renovada)
--    e o card pula direto para "Acesso Liberado". Se é cadastro novo, alguém
--    precisa criar o acesso de fato — e aí sim ele entra em "Pendente".
--
-- 2) TURMA ATUAL CONFIGURÁVEL
--    "T39" estava cravado no código em cinco lugares. Vira configuração
--    (cs.config), e o card ganha a tag da turma vigente quando o pagamento é
--    confirmado — automático (webhook) ou manual (ficha). A turma do card também
--    passa a ser editável à mão, para o caso de exceção.
--
-- Aditiva e idempotente.
-- =====================================================================

-- 1) Turma atual do programa — uma verdade, num lugar só -----------------------
-- cs.config.valor é jsonb (o resto do sistema guarda objetos ali), por isso o
-- to_jsonb na escrita e o #>> '{}' na leitura — que extrai o texto puro.
insert into cs.config (chave, valor) values ('hm_turma_atual', to_jsonb('T39'::text))
on conflict (chave) do nothing;

create or replace function cs.fn_hm_turma_atual()
returns text
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$ select coalesce((select valor #>> '{}' from cs.config where chave = 'hm_turma_atual'), 'T39'); $fn$;

grant execute on function cs.fn_hm_turma_atual() to disparos_app;

-- 2) O card registra se o acesso já existia antes de ele pagar -----------------
alter table cs.contatos_hm add column if not exists acesso_preexistente boolean not null default false;

-- 3) Provisionamento: distingue cadastro novo de renovação ---------------------
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
  v_aluno       public.thb_alunos%rowtype;
  v_aluno_id    uuid;
  v_turma_atual smallint;
  v_turma_orig  smallint;
  v_data_compra timestamptz;
  v_total       numeric := coalesce(p_valor_total, 0);
  v_pago        numeric := coalesce(p_valor_pago, 0);
  v_saldo       numeric;
  v_situacao    text;
  v_status      text;
  v_pago_em     timestamptz;
  v_ja_tinha    boolean := false;
begin
  select * into v_cp from public.compradores where id = p_comprador_id;
  if not found then return null; end if;

  select id into v_turma_atual from public.thb_turmas where codigo = cs.fn_hm_turma_atual() limit 1;

  select t.id into v_turma_orig
    from cs.contatos_hm ch
    join public.thb_turmas t on t.codigo = ch.turma_origem
   where ch.comprador_id = p_comprador_id;

  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia');
  v_data_compra := coalesce(v_data_compra, now());

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

  -- Carrega o cadastro ANTES de mexer nele: é o único momento em que dá para
  -- saber se a pessoa já tinha acesso — depois do update, a validade nova
  -- apagaria a evidência.
  select * into v_aluno from public.thb_alunos where comprador_id = p_comprador_id limit 1;
  if not found and coalesce(trim(v_cp.email), '') <> '' then
    select * into v_aluno from public.thb_alunos
     where lower(trim(email)) = lower(trim(v_cp.email)) limit 1;
  end if;
  v_aluno_id := v_aluno.id;

  -- Acesso pré-existente = já era aluno com matrícula dentro da validade. Ele não
  -- precisa que ninguém crie acesso: só teve o prazo estendido.
  v_ja_tinha := v_aluno_id is not null
                and v_aluno.data_expiracao is not null
                and v_aluno.data_expiracao >= current_date;

  if v_aluno_id is null then
    insert into public.thb_alunos (
      nome, email, telefone, documento, tipo_documento, plano, turma_id, comprador_id,
      data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
      valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
      ultimo_pagamento, fonte
    ) values (
      v_cp.nome, v_cp.email, v_cp.telefone, v_cp.documento, v_cp.tipo_documento, 'aluno',
      coalesce(v_turma_orig, v_turma_atual), p_comprador_id,
      v_data_compra, (v_pago_em + interval '365 days')::date, 'Hotmart (THB)',
      'Quitação + 365 dias', '1 ano',
      v_total, v_pago, v_saldo, v_situacao, v_status,
      current_date, 'sip_ativacao_hm'
    )
    returning id into v_aluno_id;
  else
    update public.thb_alunos set
      comprador_id        = coalesce(comprador_id, p_comprador_id),
      turma_id            = coalesce(v_turma_orig, turma_id, v_turma_atual),
      data_expiracao      = greatest(coalesce(data_expiracao, current_date), (v_pago_em + interval '365 days')::date),
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
     set aluno_id = v_aluno_id, valor_total = v_total, valor_pago = v_pago,
         acesso_preexistente = acesso_preexistente or v_ja_tinha,
         turma = coalesce(turma, cs.fn_hm_turma_atual()),
         -- Tag da turma vigente: quem paga entra na turma atual do programa.
         tags = (select coalesce(array_agg(distinct t), '{}')
                   from unnest(coalesce(tags, '{}') || array['Turma ' || cs.fn_hm_turma_atual()]) t),
         atualizado_em = now()
   where comprador_id = p_comprador_id;

  return v_aluno_id;
end$fn$;

grant execute on function cs.fn_hm_provisionar_aluno(uuid, numeric, numeric) to disparos_app;

-- 4) Onde o card cai depois do pagamento --------------------------------------
-- Quem já tinha acesso pula a fila: vai direto para "Acesso Liberado" (e o acesso
-- é carimbado em hm_liberacoes, que é a fonte de "o acesso existe"). Quem é
-- cadastro novo entra em "Pendente de Liberação" — alguém precisa criar o acesso.
create or replace function cs.fn_hm_etapa_pos_pagamento(p_comprador_id uuid)
returns text
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select case when ch.acesso_preexistente then 'hm_acesso_liberado' else 'hm_pendente_liberacao' end
    from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
$fn$;

grant execute on function cs.fn_hm_etapa_pos_pagamento(uuid) to disparos_app;

-- 5) Backfill: quem já tinha acesso e está preso na fila -----------------------
-- O sinal de "já tinha acesso" é a ORIGEM do cadastro, não a data: o cadastro do
-- lead novo nasce no mesmo minuto do card, e comparar timestamps erra por
-- segundos (foi o que marcou a Laura, um lead novo, como se já tivesse acesso).
-- Se quem criou o cadastro foi o próprio funil ('sip_ativacao_hm'), não havia
-- acesso antes — alguém ainda precisa criá-lo.
update cs.contatos_hm ch
   set acesso_preexistente = (
         a.id is not null
         and coalesce(a.fonte, '') <> 'sip_ativacao_hm'
         and a.data_expiracao is not null
         and a.data_expiracao >= current_date
       ),
       atualizado_em = now()
  from public.thb_alunos a
 where a.id = ch.aluno_id;

with alvo as (
  select ch.id, ch.comprador_id
    from cs.contatos_hm ch
    join cs.estagios e on e.id = ch.estagio_id
   where e.chave = 'hm_pendente_liberacao' and ch.acesso_preexistente
)
update cs.contatos_hm ch
   set estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_acesso_liberado'),
       atualizado_em = now()
  from alvo where ch.id = alvo.id;

insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select ch.id, 'sistema',
       'Acesso já existia antes do pagamento (matrícula vigente na base) — card não passa pela fila de liberação',
       'sistema'
  from cs.contatos_hm ch
  join cs.estagios e on e.id = ch.estagio_id
 where ch.acesso_preexistente and e.chave = 'hm_acesso_liberado'
   and not exists (select 1 from cs.interacoes i where i.contato_hm_id = ch.id
                    and i.descricao like 'Acesso já existia%');
