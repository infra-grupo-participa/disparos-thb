-- =====================================================================
-- 0039_cs_hm_origem_tags
-- Reescreve o tagueamento de origem do sinal R$300 (oferta z391kxd9) no HM.
-- Substitui a lógica "tudo = HT ATM" (0035/0036) por 3 eixos:
--
--   1) PÚBLICO (pela base public.vw_aluno_360):
--        aurum (espaco_instrucao='aurum') → tag 'Aurum'
--        demais na base                    → tag 'HM'
--        fora da base                      → tag 'Novo'
--   2) TURMA(S) (pela base):
--        Aurum → turma THB (turma_codigo, ex 'T17') + turma Aurum (ex 'A5')
--        HM    → turma THB
--        Novo  → nenhuma
--   3) EVENTO (pela DATA da compra do sinal):
--        25-26/06 → 'Live Direto ao Ponto'
--        06/07    → 'HT ATM'
--        (07-08/07 e demais → sem tag de evento; público+turma bastam)
--
-- Enriquecimento (timeline + observacoes) para quem está na base.
-- Idempotente. SECURITY DEFINER (cruza cs -> public.vw_aluno_360).
-- =====================================================================

-- 1) Classifica e aplica as tags de origem para UM comprador -----------------
create or replace function cs.fn_tag_hm_origem(p_comprador_id uuid)
returns text                       -- público aplicado: 'Aurum' | 'HM' | 'Novo'
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_card       record;
  al           record;
  v_na_base    boolean := false;
  v_publico    text;
  v_evento     text;
  v_dt         timestamptz;
  v_turma_thb  text;
  v_turma_aur  text;
  v_espaco     text;
  v_resumo     text;
  v_marcador   constant text := E'⟦HM origem⟧';
  v_novas      text[];
begin
  select ch.id, ch.tags, ch.observacoes,
         lower(trim(cmp.email)) as email,
         right(regexp_replace(coalesce(cmp.telefone, ''), '[^0-9]', '', 'g'), 10) as tel10
    into v_card
    from cs.contatos_hm ch
    join public.compradores cmp on cmp.id = ch.comprador_id
   where ch.comprador_id = p_comprador_id;
  if not found then
    return null;
  end if;

  -- Data da compra do sinal (define o evento). Menor data aprovada da oferta.
  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_dt
    from public.compras c
   where c.comprador_id = p_comprador_id
     and c.oferta_codigo = 'z391kxd9'
     and c.status in ('APPROVED','COMPLETE','COMPLETED');

  -- Match na base mestre de alunos (comprador_id > email > telefone).
  select v.turma_codigo, ta.codigo as turma_aurum, v.espaco_instrucao,
         v.profissao, v.cidade, v.estado, v.eh_socio
    into al
    from public.vw_aluno_360 v
    left join public.thb_turmas ta on ta.id = v.turma_aurum_id
   where v.comprador_id = p_comprador_id
      or (v.email is not null and lower(trim(v.email)) = v_card.email and v_card.email <> '')
      or (length(v_card.tel10) = 10
          and right(regexp_replace(coalesce(v.telefone_e164, v.telefone, ''), '[^0-9]', '', 'g'), 10) = v_card.tel10)
   order by (v.comprador_id = p_comprador_id) desc nulls last,
            (lower(trim(v.email)) = v_card.email) desc nulls last
   limit 1;
  v_na_base := found;

  -- Público + turma(s)
  if not v_na_base then
    v_publico := 'Novo';
  elsif al.espaco_instrucao = 'aurum' then
    v_publico    := 'Aurum';
    v_turma_thb  := nullif(trim(al.turma_codigo), '');
    v_turma_aur  := nullif(trim(al.turma_aurum), '');
  else
    v_publico    := 'HM';
    v_turma_thb  := nullif(trim(al.turma_codigo), '');
  end if;

  -- Evento pela data da compra do sinal (janelas em America/Sao_Paulo).
  if v_dt is not null then
    if v_dt >= '2026-06-25 00:00:00-03' and v_dt < '2026-06-27 00:00:00-03' then
      v_evento := 'Live Direto ao Ponto';
    elsif v_dt >= '2026-07-06 00:00:00-03' and v_dt < '2026-07-07 00:00:00-03' then
      v_evento := 'HT ATM';
    end if;
  end if;

  -- Aplica as tags (idempotente: união distinta, preserva tags externas p.ex. "No grupo").
  v_novas := array_remove(array[v_publico, v_evento, v_turma_thb, v_turma_aur], null);
  update cs.contatos_hm
     set tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(tags, '{}') || v_novas) t),
         atualizado_em = now()
   where id = v_card.id;

  -- Enriquecimento na ficha (só quem está na base), idempotente via marcador.
  if v_na_base and position(v_marcador in coalesce(v_card.observacoes, '')) = 0 then
    v_espaco := initcap(replace(coalesce(al.espaco_instrucao, ''), '_', ' '));
    v_resumo := concat_ws(' · ',
      'Aluno ' || v_publico,
      case when v_turma_thb is not null then 'THB ' || v_turma_thb end,
      case when v_turma_aur is not null then 'Aurum ' || v_turma_aur end,
      nullif(v_espaco, ''),
      nullif(concat_ws('/', nullif(al.cidade, ''), nullif(al.estado, '')), ''),
      nullif(al.profissao, ''),
      case when al.eh_socio then 'Sócio' end
    );
    update cs.contatos_hm
       set observacoes = trim(both E'\n' from
             coalesce(observacoes, '') || E'\n' || v_marcador || ' ' || v_resumo),
           atualizado_em = now()
     where id = v_card.id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card.id, 'sistema', 'Origem HM: ' || v_resumo, 'sistema');
  end if;

  return v_publico;
end
$fn$;

grant execute on function cs.fn_tag_hm_origem(uuid) to disparos_app;

-- 2) Sync/reprocesso em lote: limpa tags gerenciadas antigas e reaplica -------
-- (o tipo de retorno mudou vs 0036 — precisa dropar antes)
drop function if exists cs.fn_sync_hm_atm(timestamptz);
create or replace function cs.fn_sync_hm_atm(
  p_desde timestamptz default '2026-06-25 00:00:00-03'
)
returns table (
  cards_alvo integer,
  aurum      integer,
  hm         integer,
  novo       integer
)
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  r       record;
  v_pub   text;
  n_alvo int := 0; n_a int := 0; n_h int := 0; n_n int := 0;
begin
  for r in
    select ch.comprador_id, ch.id as card_id
      from cs.contatos_hm ch
     where exists (
       select 1 from public.compras c
        where c.comprador_id = ch.comprador_id
          and c.oferta_codigo = 'z391kxd9'
          and c.status in ('APPROVED','COMPLETE','COMPLETED')
          and coalesce(c.data_aprovacao, c.data_compra) >= p_desde
     )
  loop
    n_alvo := n_alvo + 1;

    -- Limpa tags gerenciadas por esta lógica (mantém as externas: "No grupo" etc):
    -- rótulos de origem + qualquer código de turma real (thb_turmas).
    update cs.contatos_hm
       set tags = (
         select coalesce(array_agg(t), '{}')
           from unnest(tags) t
          where t not in ('HT ATM','Aurum','HM','Novo','Live Direto ao Ponto')
            and t not in (select codigo from public.thb_turmas)
       ),
       observacoes = nullif(trim(both E'\n' from
         regexp_replace(coalesce(observacoes, ''), E'\\n?⟦(HT ATM|HM origem)⟧.*$', '')), '')
     where id = r.card_id;

    delete from cs.interacoes i
     where i.contato_hm_id = r.card_id
       and i.tipo = 'sistema'
       and (i.descricao like 'Origem HM:%' or i.descricao like 'Aluno identificado na base (HT ATM)%');

    -- Reaplica pela regra atual.
    v_pub := cs.fn_tag_hm_origem(r.comprador_id);
    if    v_pub = 'Aurum' then n_a := n_a + 1;
    elsif v_pub = 'HM'    then n_h := n_h + 1;
    else                       n_n := n_n + 1;
    end if;
  end loop;

  return query select n_alvo, n_a, n_h, n_n;
end
$fn$;

-- 3) Trigger de venda passa a usar a nova classificação ----------------------
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

  -- Parcela de parcelamento (HOTMART_INSTALLMENTS): reenvio por parcela → ignora.
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

    -- Classificação de origem (público/evento/turma). Nunca derruba a compra.
    begin
      perform cs.fn_tag_hm_origem(new.comprador_id);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;
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

-- 4) Remove a função antiga (substituída por fn_tag_hm_origem) ----------------
drop function if exists cs.fn_tag_ht_atm_comprador(uuid);
