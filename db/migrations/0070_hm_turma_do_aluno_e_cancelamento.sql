-- =====================================================================
-- 0070_hm_turma_do_aluno_e_cancelamento
-- Três regras de produto decididas em 14/07:
--
-- 1) TURMA — aluno da base mantém a SUA turma; T39 é só para lead novo.
--    A base mestre já fazia certo (0055), mas o CARD ganhava "Turma T39" no
--    provisionamento, para todo mundo. Agora o card espelha a turma REAL que
--    ficou gravada no aluno. Backfill corrige os já provisionados.
--
-- 2) CANCELAMENTO — quem NASCEU por este funil (thb_alunos.fonte =
--    'sip_ativacao_hm') e cancela SOME da base: a linha é excluída (os sócios
--    que nasceram pendurados nele também), e o GPS não o vê mais. O card fica
--    no sistema de ativação com o histórico; se pagar de novo, o
--    provisionamento recria. Aluno que JÁ EXISTIA mantém todos os dados — só a
--    situação financeira é atualizada. Exceção: aluno novo com depoimento
--    gravado (FK RESTRICT) não pode ser excluído — vira "cancelado" marcado.
--
-- 3) EDIÇÃO ADMIN — identidade (nome/e-mail/telefone) se corrige na FONTE
--    (public.compradores) e espelha na base; financeiro idem. O role da
--    aplicação não escreve nessas tabelas — a função definer é a porta, e a
--    rota (só admin) é quem a chama.
-- Idempotente.
-- =====================================================================

-- 1) A turma do card é a turma do aluno -----------------------------------
create or replace function cs.fn_hm_provisionar_aluno(p_comprador_id uuid, p_valor_total numeric, p_valor_pago numeric)
returns uuid
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_cp          public.compradores%rowtype;
  v_aluno       public.thb_alunos%rowtype;
  v_aluno_id    uuid;
  v_turma_atual smallint;
  v_turma_orig  smallint;
  v_turma_final smallint;
  v_codigo      text;
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
    from cs.contatos_hm ch join public.thb_turmas t on t.codigo = ch.turma_origem
   where ch.comprador_id = p_comprador_id;

  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra
    from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia');
  v_data_compra := coalesce(v_data_compra, now());

  select max(coalesce(c.data_aprovacao, c.data_compra)) into v_pago_em
    from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('diferenca','compra_cheia');
  v_pago_em := coalesce(v_pago_em, now());

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
    -- Aluno NOVO: nasce na turma atual (T39) — a menos que o card saiba a
    -- origem (caso raro de base não casada), que então prevalece.
    v_turma_final := coalesce(v_turma_orig, v_turma_atual);
    insert into public.thb_alunos (
      nome, email, telefone, documento, tipo_documento, plano, turma_id, comprador_id,
      data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
      valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
      ultimo_pagamento, fonte
    ) values (
      v_cp.nome, v_cp.email, v_cp.telefone, v_cp.documento, v_cp.tipo_documento, 'aluno',
      v_turma_final, p_comprador_id,
      v_data_compra, (v_pago_em + interval '365 days')::date, 'Hotmart (THB)',
      'Quitação + 365 dias', '1 ano', v_total, v_pago, v_saldo, v_situacao, v_status,
      current_date, 'sip_ativacao_hm'
    ) returning id into v_aluno_id;
  else
    -- Aluno DA BASE: mantém a turma dele (origem detectada > a que já tem).
    -- T39 aqui é só o último recurso de dado faltante — nunca uma troca.
    v_turma_final := coalesce(v_turma_orig, v_aluno.turma_id, v_turma_atual);
    update public.thb_alunos set
      comprador_id = coalesce(comprador_id, p_comprador_id),
      turma_id = v_turma_final,
      data_expiracao = greatest(coalesce(data_expiracao, current_date), (v_pago_em + interval '365 days')::date),
      regra_acesso = 'Renovação HM + 365 dias', tempo_acesso = '1 ano',
      telefone = coalesce(telefone, v_cp.telefone), documento = coalesce(documento, v_cp.documento),
      valor_total = v_total, valor_pago = v_pago, saldo_devedor = v_saldo,
      situacao_financeira = v_situacao, status_pagamento = v_status,
      ultimo_pagamento = current_date, atualizado_em = now()
    where id = v_aluno_id;
  end if;

  select codigo into v_codigo from public.thb_turmas where id = v_turma_final;

  -- O card espelha a turma REAL gravada no aluno: a tag "Turma X" antiga sai,
  -- a certa entra. Aluno da base deixa de ganhar "Turma T39".
  update cs.contatos_hm
     set aluno_id = v_aluno_id, valor_total = v_total, valor_pago = v_pago,
         acesso_preexistente = acesso_preexistente or v_ja_tinha,
         turma = coalesce(v_codigo, turma, cs.fn_hm_turma_atual()),
         tags = (select coalesce(array_agg(distinct t), '{}')
                   from unnest(array(select x from unnest(coalesce(tags, '{}')) x where x !~ '^Turma ')
                        || array['Turma ' || coalesce(v_codigo, cs.fn_hm_turma_atual())]) t),
         atualizado_em = now()
   where comprador_id = p_comprador_id;

  return v_aluno_id;
end$function$;

-- Backfill: cards de aluno da base provisionados com "Turma T39" indevida.
update cs.contatos_hm ch
   set turma = ch.turma_origem,
       tags = (select coalesce(array_agg(distinct t), '{}')
                 from unnest(array(select x from unnest(coalesce(ch.tags, '{}')) x where x !~ '^Turma ')
                      || array['Turma ' || ch.turma_origem]) t),
       atualizado_em = now()
 where ch.turma_origem is not null
   and ch.apto_ativacao
   and ch.turma is distinct from ch.turma_origem;

-- 2) Cancelamento: quem nasceu aqui some; quem já existia mantém tudo -------
create or replace function cs.fn_hm_cancelar(p_comprador_id uuid)
returns text
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aluno public.thb_alunos%rowtype;
begin
  select a.* into v_aluno
    from cs.contatos_hm ch
    join public.thb_alunos a on a.id = ch.aluno_id
   where ch.comprador_id = p_comprador_id;
  if not found then return 'sem_aluno'; end if;

  if v_aluno.fonte = 'sip_ativacao_hm'
     and not exists (select 1 from public.gp_depoimentos d where d.aluno_id = v_aluno.id) then
    -- Nasceu por este funil e cancelou: some da base. Os sócios que só existem
    -- por causa dele vão junto; o resto das dependências é CASCADE/SET NULL.
    delete from public.thb_alunos
     where socio_de_aluno_id = v_aluno.id and fonte = 'sip_ativacao_hm';
    delete from public.thb_alunos where id = v_aluno.id;
    update cs.contatos_hm set aluno_id = null, atualizado_em = now()
     where comprador_id = p_comprador_id;
    return 'excluido';
  end if;

  -- Aluno que já existia (ou novo com depoimento, que a FK protege): mantém
  -- todos os dados — só a situação financeira registra o cancelamento.
  update public.thb_alunos
     set situacao_financeira = 'cancelado',
         status_pagamento = 'Cancelado (HM)',
         atualizado_em = now()
   where id = v_aluno.id;
  return 'atualizado';
end$function$;

grant execute on function cs.fn_hm_cancelar(uuid) to disparos_app;

-- 3) Edição administrativa: identidade e financeiro na FONTE ----------------
-- null = não mexe naquele campo. Identidade corrige compradores (de onde nome/
-- e-mail/telefone saem para card, base e disparo) e espelha em thb_alunos;
-- financeiro atualiza card + base e refaz o saldo.
create or replace function cs.fn_hm_admin_editar(
  p_comprador_id uuid,
  p_nome text, p_email text, p_telefone text,
  p_valor_total numeric, p_valor_pago numeric
)
returns boolean
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aluno_id uuid;
begin
  update public.compradores
     set nome = coalesce(p_nome, nome),
         email = coalesce(p_email, email),
         telefone = coalesce(p_telefone, telefone),
         atualizado_em = now()
   where id = p_comprador_id;
  if not found then return false; end if;

  select aluno_id into v_aluno_id from cs.contatos_hm where comprador_id = p_comprador_id;

  update cs.contatos_hm
     set valor_total = coalesce(p_valor_total, valor_total),
         valor_pago = coalesce(p_valor_pago, valor_pago),
         atualizado_em = now()
   where comprador_id = p_comprador_id
     and (p_valor_total is not null or p_valor_pago is not null);

  if v_aluno_id is not null then
    update public.thb_alunos a
       set nome = coalesce(p_nome, a.nome),
           email = coalesce(p_email, a.email),
           telefone = coalesce(p_telefone, a.telefone),
           valor_total = coalesce(p_valor_total, a.valor_total),
           valor_pago = coalesce(p_valor_pago, a.valor_pago),
           saldo_devedor = case
             when p_valor_total is not null or p_valor_pago is not null
             then greatest(coalesce(p_valor_total, a.valor_total, 0) - coalesce(p_valor_pago, a.valor_pago, 0), 0)
             else a.saldo_devedor end,
           atualizado_em = now()
     where a.id = v_aluno_id;
  end if;

  return true;
end$function$;

grant execute on function cs.fn_hm_admin_editar(uuid, text, text, text, numeric, numeric) to disparos_app;
