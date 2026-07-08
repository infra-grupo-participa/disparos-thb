-- =====================================================================
-- 0035_cs_sync_hm_atm
-- Sync/tagueamento dos compradores do evento "HT ATM" (oferta Sinal R$300,
-- offer_code z391kxd9) no módulo de Ativação HM (cs.contatos_hm).
--
-- Contexto: a oferta HT ATM foi feita PARA a base de alunos existente. Quase
-- todos os compradores já são alunos (THB), então o CS precisa saber turma e
-- espaço de instrução de origem. A base mestre de alunos é public.vw_aluno_360
-- (2.4k alunos, já vinculada a public.compradores por comprador_id).
--
-- A função cs.fn_sync_hm_atm(p_desde):
--   0) SYNC GERAL: garante card HM para todo comprador HT ATM na janela
--      (fallback se o webhook/trigger falhou).
--   1) Aplica a tag 'HT ATM' (origem da oferta) em TODOS os alvos.
--   2) DIFERENCIAÇÃO — se o comprador já é aluno (existe em vw_aluno_360),
--      aplica a tag da turma dele (ex.: 'T29') e enriquece o card com uma
--      NOTA na timeline + resumo em observacoes (turma, espaço de instrução,
--      cidade, profissão, sócio). Lead novo fica só com 'HT ATM'.
--
-- Casa o aluno por comprador_id (direto), com fallback e-mail / telefone.
-- Idempotente: reexecutar não duplica tags nem notas. SECURITY DEFINER porque
-- cruza cs -> public.vw_aluno_360 (o role do app não lê a base de alunos).
-- =====================================================================

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
  v_offer    constant text := 'z391kxd9';   -- Sinal R$300 — ofertado no evento HT ATM
  v_tag_atm  constant text := 'HT ATM';
  v_marcador constant text := E'⟦HT ATM⟧'; -- marcador de idempotência nas observacoes
  v_ini      smallint;
  r          record;
  al         record;
  v_espaco   text;
  v_resumo   text;
  v_turma_tag text;
  n_alvo int := 0; n_semeados int := 0; n_tag int := 0; n_vet int := 0; n_novo int := 0;
begin
  select id into v_ini from cs.estagios where evento = 'HM' and chave = 'hm_comprou' limit 1;

  -- 0) SYNC GERAL: cria card para comprador HT ATM na janela que ainda não tem.
  insert into cs.contatos_hm (comprador_id, estagio_id, turma, categoria_entrada)
  select distinct c.comprador_id, v_ini, 'T39', 'sinal'
    from public.compras c
   where c.oferta_codigo = v_offer
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(c.data_aprovacao, c.data_compra) >= p_desde
     and not exists (select 1 from cs.contatos_hm ch where ch.comprador_id = c.comprador_id)
  on conflict (comprador_id) do nothing;
  get diagnostics n_semeados = row_count;

  -- Itera sobre os cards-alvo (compradores do evento HT ATM na janela).
  for r in
    select ch.id as card_id, ch.comprador_id, ch.tags, ch.observacoes,
           lower(trim(cmp.email)) as email,
           right(regexp_replace(coalesce(cmp.telefone,''), '[^0-9]', '', 'g'), 10) as tel10
      from cs.contatos_hm ch
      join public.compradores cmp on cmp.id = ch.comprador_id
     where exists (
       select 1 from public.compras c
        where c.comprador_id = ch.comprador_id
          and c.oferta_codigo = v_offer
          and c.status in ('APPROVED','COMPLETE','COMPLETED')
          and coalesce(c.data_aprovacao, c.data_compra) >= p_desde
     )
  loop
    n_alvo := n_alvo + 1;

    -- 1) Tag de origem 'HT ATM' em todos (idempotente).
    if not (coalesce(r.tags, '{}') @> array[v_tag_atm]) then
      update cs.contatos_hm
         set tags = array_append(coalesce(tags, '{}'), v_tag_atm), atualizado_em = now()
       where id = r.card_id;
      n_tag := n_tag + 1;
    end if;

    -- 2) É aluno? Busca o melhor match na base mestre (comprador_id > email > telefone).
    select v.turma_codigo, v.turma_tipo, v.espaco_instrucao, v.instrucao,
           v.profissao, v.cidade, v.estado, v.eh_socio, v.plano
      into al
      from public.vw_aluno_360 v
     where v.comprador_id = r.comprador_id
        or (v.email is not null and lower(trim(v.email)) = r.email and r.email <> '')
        or (length(r.tel10) = 10
            and right(regexp_replace(coalesce(v.telefone_e164, v.telefone, ''), '[^0-9]', '', 'g'), 10) = r.tel10)
     order by (v.comprador_id = r.comprador_id) desc nulls last,
              (lower(trim(v.email)) = r.email) desc nulls last
     limit 1;

    if not found then
      n_novo := n_novo + 1;              -- lead novo: fica só com 'HT ATM'
      continue;
    end if;

    n_vet := n_vet + 1;

    -- Tag da turma de origem (ex.: 'T29'), idempotente.
    v_turma_tag := nullif(trim(al.turma_codigo), '');
    if v_turma_tag is not null
       and not (coalesce(r.tags, '{}') @> array[v_turma_tag])
       and not (coalesce(r.tags, '{}') @> array[v_tag_atm, v_turma_tag]) then
      update cs.contatos_hm
         set tags = array_append(coalesce(tags, '{}'), v_turma_tag), atualizado_em = now()
       where id = r.card_id
         and not (tags @> array[v_turma_tag]);
    end if;

    -- Rótulo legível do espaço de instrução (holding_masters -> "Holding Masters").
    v_espaco := initcap(replace(coalesce(al.espaco_instrucao, ''), '_', ' '));

    -- Resumo do aluno para o CS (turma · espaço · cidade/UF · profissão · sócio).
    v_resumo := concat_ws(' · ',
      case when v_turma_tag is not null then 'Turma ' || v_turma_tag
             || case when al.turma_tipo is not null then ' (' || upper(al.turma_tipo) || ')' else '' end end,
      nullif(v_espaco, ''),
      nullif(concat_ws('/', nullif(al.cidade, ''), nullif(al.estado, '')), ''),
      nullif(al.profissao, ''),
      -- plano só quando agrega ('aurum' etc); 'aluno' é ruído (todos são alunos).
      case when al.plano is not null and lower(trim(al.plano)) not in ('aluno', '') then initcap(al.plano) end,
      case when al.eh_socio then 'Sócio' end
    );

    -- Enriquece observacoes + timeline uma única vez (marcador garante idempotência).
    if position(v_marcador in coalesce(r.observacoes, '')) = 0 then
      update cs.contatos_hm
         set observacoes = trim(both E'\n' from
               coalesce(observacoes, '') || E'\n' || v_marcador || ' Aluno da base — ' || v_resumo),
             atualizado_em = now()
       where id = r.card_id;

      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (r.card_id, 'sistema', 'Aluno identificado na base (HT ATM) — ' || v_resumo, 'sistema');
    end if;
  end loop;

  return query select n_alvo, n_semeados, n_tag, n_vet, n_novo;
end
$fn$;

-- Permite reexecutar o sync pelo app/cron (a função roda com privilégios do owner).
grant execute on function cs.fn_sync_hm_atm(timestamptz) to disparos_app;
