-- =====================================================================
-- 0036_cs_ht_atm_trigger
-- Torna o tagueamento HT ATM AUTOMÁTICO: dispara junto do webhook de venda do
-- HM (trigger em public.compras), sem cron/backfill manual.
--
-- 1) cs.fn_tag_ht_atm_comprador(uuid) — aplica, para UM comprador já com card
--    HM, a tag 'HT ATM' e, se ele já é aluno da base (public.vw_aluno_360),
--    a tag da turma + enriquecimento (timeline/observacoes). Idempotente.
--    Retorna true se casou como aluno. Extraída de cs.fn_sync_hm_atm (0035).
-- 2) cs.fn_sync_hm_atm(p_desde) — reescrita para reusar a função acima (lote).
-- 3) cs.fn_seed_contato_hm() — trigger de venda estendido: ao criar o card de
--    uma compra cuja oferta é do evento HT ATM (catalog.notes contém 'HT ATM'),
--    chama a função 1). Assim toda nova venda HT ATM já entra tagueada.
-- =====================================================================

-- 1) Função por-comprador (reutilizada pelo lote e pelo trigger) --------------
create or replace function cs.fn_tag_ht_atm_comprador(p_comprador_id uuid)
returns boolean
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_tag_atm  constant text := 'HT ATM';
  v_marcador constant text := E'⟦HT ATM⟧';
  v_card     record;
  al         record;
  v_espaco   text;
  v_resumo   text;
  v_turma_tag text;
begin
  select ch.id, ch.tags, ch.observacoes,
         lower(trim(cmp.email)) as email,
         right(regexp_replace(coalesce(cmp.telefone, ''), '[^0-9]', '', 'g'), 10) as tel10
    into v_card
    from cs.contatos_hm ch
    join public.compradores cmp on cmp.id = ch.comprador_id
   where ch.comprador_id = p_comprador_id;
  if not found then
    return false;                       -- sem card HM: nada a taguear
  end if;

  -- Tag de origem 'HT ATM' (idempotente).
  if not (coalesce(v_card.tags, '{}') @> array[v_tag_atm]) then
    update cs.contatos_hm
       set tags = array_append(coalesce(tags, '{}'), v_tag_atm), atualizado_em = now()
     where id = v_card.id;
  end if;

  -- É aluno? Melhor match na base mestre (comprador_id > email > telefone).
  select v.turma_codigo, v.turma_tipo, v.espaco_instrucao,
         v.profissao, v.cidade, v.estado, v.eh_socio, v.plano
    into al
    from public.vw_aluno_360 v
   where v.comprador_id = p_comprador_id
      or (v.email is not null and lower(trim(v.email)) = v_card.email and v_card.email <> '')
      or (length(v_card.tel10) = 10
          and right(regexp_replace(coalesce(v.telefone_e164, v.telefone, ''), '[^0-9]', '', 'g'), 10) = v_card.tel10)
   order by (v.comprador_id = p_comprador_id) desc nulls last,
            (lower(trim(v.email)) = v_card.email) desc nulls last
   limit 1;
  if not found then
    return false;                       -- lead novo: fica só com 'HT ATM'
  end if;

  -- Tag da turma de origem (ex.: 'T29'), idempotente.
  v_turma_tag := nullif(trim(al.turma_codigo), '');
  if v_turma_tag is not null and not (coalesce(v_card.tags, '{}') @> array[v_turma_tag]) then
    update cs.contatos_hm
       set tags = array_append(coalesce(tags, '{}'), v_turma_tag), atualizado_em = now()
     where id = v_card.id and not (tags @> array[v_turma_tag]);
  end if;

  v_espaco := initcap(replace(coalesce(al.espaco_instrucao, ''), '_', ' '));
  v_resumo := concat_ws(' · ',
    case when v_turma_tag is not null then 'Turma ' || v_turma_tag
           || case when al.turma_tipo is not null then ' (' || upper(al.turma_tipo) || ')' else '' end end,
    nullif(v_espaco, ''),
    nullif(concat_ws('/', nullif(al.cidade, ''), nullif(al.estado, '')), ''),
    nullif(al.profissao, ''),
    case when al.plano is not null and lower(trim(al.plano)) not in ('aluno', '') then initcap(al.plano) end,
    case when al.eh_socio then 'Sócio' end
  );

  -- Enriquece observacoes + timeline uma única vez (marcador = idempotência).
  if position(v_marcador in coalesce(v_card.observacoes, '')) = 0 then
    update cs.contatos_hm
       set observacoes = trim(both E'\n' from
             coalesce(observacoes, '') || E'\n' || v_marcador || ' Aluno da base — ' || v_resumo),
           atualizado_em = now()
     where id = v_card.id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card.id, 'sistema', 'Aluno identificado na base (HT ATM) — ' || v_resumo, 'sistema');
  end if;

  return true;
end
$fn$;

grant execute on function cs.fn_tag_ht_atm_comprador(uuid) to disparos_app;

-- 2) Lote/backfill: mesma lógica, agora delegando à função por-comprador -------
create or replace function cs.fn_sync_hm_atm(
  p_desde timestamptz default
    ((( now() at time zone 'America/Sao_Paulo')::date - 1)::timestamp at time zone 'America/Sao_Paulo')
)
returns table (
  cards_alvo             integer,
  cards_semeados         integer,
  tagueados_ht_atm       integer,
  alunos_enriquecidos    integer,
  leads_novos            integer
)
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_offer constant text := 'z391kxd9';   -- Sinal R$300 — evento HT ATM
  v_ini   smallint;
  r       record;
  v_aluno boolean;
  n_alvo int := 0; n_semeados int := 0; n_tag int := 0; n_vet int := 0; n_novo int := 0;
begin
  select id into v_ini from cs.estagios where evento = 'HM' and chave = 'hm_comprou' limit 1;

  insert into cs.contatos_hm (comprador_id, estagio_id, turma, categoria_entrada)
  select distinct c.comprador_id, v_ini, 'T39', 'sinal'
    from public.compras c
   where c.oferta_codigo = v_offer
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(c.data_aprovacao, c.data_compra) >= p_desde
     and not exists (select 1 from cs.contatos_hm ch where ch.comprador_id = c.comprador_id)
  on conflict (comprador_id) do nothing;
  get diagnostics n_semeados = row_count;

  for r in
    select ch.comprador_id, ch.tags
      from cs.contatos_hm ch
     where exists (
       select 1 from public.compras c
        where c.comprador_id = ch.comprador_id
          and c.oferta_codigo = v_offer
          and c.status in ('APPROVED','COMPLETE','COMPLETED')
          and coalesce(c.data_aprovacao, c.data_compra) >= p_desde
     )
  loop
    n_alvo := n_alvo + 1;
    if not (coalesce(r.tags, '{}') @> array['HT ATM']) then n_tag := n_tag + 1; end if;
    v_aluno := cs.fn_tag_ht_atm_comprador(r.comprador_id);
    if v_aluno then n_vet := n_vet + 1; else n_novo := n_novo + 1; end if;
  end loop;

  return query select n_alvo, n_semeados, n_tag, n_vet, n_novo;
end
$fn$;

-- 3) Trigger de venda estendido: taguear na hora quando a oferta é HT ATM ------
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
  v_apto  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  select cat.categoria, cat.notes into v_cat, v_notes
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if v_cat is null then
    return new;
  end if;

  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_apto from cs.estagios where evento='HM' and chave='hm_apto_ativacao' limit 1;

  if v_cat in ('sinal','compra_cheia')
     and coalesce(new.data_aprovacao, new.data_compra, now()) >= v_cutoff then
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

    -- HT ATM: venda do evento onde a oferta foi feita → tag + enriquecimento.
    if v_notes ilike '%HT ATM%' then
      perform cs.fn_tag_ht_atm_comprador(new.comprador_id);
    end if;
    return new;
  end if;

  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_apto,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_apto;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — apto para ativação', 'sistema');
      end if;
    end if;
    return new;
  end if;

  return new;
end$function$;
