-- =====================================================================
-- 0041_cs_hm_aurum_por_turma
-- Amplia a definição do público 'Aurum' na classificação de origem do HM.
--
-- O Programa de Implementação Assistida passa a ser ofertado à base Aurum.
-- Até aqui (0039) "ser Aurum" era só espaco_instrucao = 'aurum' (211 alunos).
-- Mas o espaço de instrução reflete onde o aluno está HOJE, não por onde
-- passou: 68 alunos têm turma Aurum (turma_aurum_id) e hoje constam em outro
-- espaço (holding_masters, platina, mastermind_diamante). Eles são público da
-- oferta e caíam como 'HM'.
--
--   Aurum := está na base E (espaco_instrucao = 'aurum' OU turma_aurum_id preenchido)
--
-- Passa de 211 para 279 alunos elegíveis. A tag da turma Aurum (ex.: 'A5')
-- passa a ser aplicada sempre que houver turma_aurum_id — inclusive para quem
-- migrou de espaço —, junto da turma THB.
--
-- Sem tag de evento nova: a oferta reaproveita o sinal z391kxd9 e o próprio
-- rótulo 'Aurum' identifica o público. As janelas de evento existentes
-- (25-26/06 → Live Direto ao Ponto; 06/07 → HT ATM) seguem inalteradas, e as
-- compras a partir de 07/07 continuam sem tag de evento.
--
-- Idempotente. SECURITY DEFINER (cruza cs -> public.vw_aluno_360).
-- Reprocesso da base existente: select * from cs.fn_sync_hm_atm();
-- =====================================================================

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
  select v.turma_codigo, v.turma_aurum_id, ta.codigo as turma_aurum, v.espaco_instrucao,
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

  -- Público + turma(s). A turma THB vale para todo aluno da base; a turma Aurum
  -- é aplicada sempre que existir, mesmo que o aluno tenha migrado de espaço.
  if not v_na_base then
    v_publico := 'Novo';
  else
    v_turma_thb := nullif(trim(al.turma_codigo), '');
    v_turma_aur := nullif(trim(al.turma_aurum), '');
    -- Aurum por espaço atual OU por ter cursado uma turma Aurum.
    if al.espaco_instrucao = 'aurum' or al.turma_aurum_id is not null then
      v_publico := 'Aurum';
    else
      v_publico := 'HM';
    end if;
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
