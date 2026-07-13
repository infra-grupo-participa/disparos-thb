-- =====================================================================
-- 0052_hm_canal_pelo_fato
-- O canal de aquisição do HM passa a ser derivado dos FATOS, não do texto da
-- oferta.
--
-- O problema: a oferta z391kxd9 (sinal de R$300) é usada em TODOS os canais —
-- HT ATM, Live Direto ao Ponto, HT 28, HT 29, base interna. Mas o catálogo a
-- descreve como "Sinal R$300 (ofertado no evento HT ATM)", e era esse texto que
-- carimbava a origem. Resultado: Laura Cardoso aparecia como HT ATM quando na
-- verdade comprou o ingresso do Holding Total em 01/07 — dentro da janela de
-- vendas da HT28 (22/06 → 06/07). 6 dos 17 cards que compraram ingresso do HT
-- estavam com origem errada.
--
-- A verdade sempre esteve no banco, em dois lugares:
--   1) public.thb_alunos / vw_aluno_360 — quem a pessoa É (Aurum, aluno, novo);
--   2) a compra do INGRESSO do Holding Total (produto 1560865) cruzada com a
--      janela de vendas da edição (public.ht_editions) — por onde ela ENTROU.
--
-- Regra do canal (uma tag só, nesta ordem — decidida com o time):
--   a) está na base (Aurum ou aluno HM) → 'HM - Programa de Implementação'
--      (a oferta foi feita PARA a base; um ingresso de HT no meio é coincidência)
--   b) é lead novo e comprou ingresso do HT → a edição da janela ('HT28'…)
--   c) é lead novo, sem ingresso → o evento da data do sinal:
--        25–26/06 → 'Live Direto ao Ponto'   |   06–07/07 → 'HT ATM'
--   d) nada disso → sem tag de canal
--
-- Público (Aurum/HM/Novo) e turma continuam vindo da base — isso já estava certo.
-- Idempotente: a função reaplica as tags gerenciadas e preserva as externas
-- ("No grupo", "Respondeu qualificação"…).
-- =====================================================================

-- 1) Por qual edição do HT a pessoa entrou (null se não comprou ingresso) ------
-- O ingresso é o produto 1560865 ("Holding Total"). A edição sai da janela de
-- vendas em que a compra caiu — é assim que o próprio funil do HT se organiza.
create or replace function cs.fn_hm_edicao_ht(p_comprador_id uuid)
returns text
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select 'HT' || e.edition_number
    from public.compras c
    join public.ht_editions e
      on c.data_compra >= e.sale_start_at
     and c.data_compra <  e.sale_end_at
   where c.comprador_id = p_comprador_id
     and c.produto_id = '1560865'
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
   order by c.data_compra desc
   limit 1;
$fn$;

grant execute on function cs.fn_hm_edicao_ht(uuid) to disparos_app;

-- 2) Classificação de origem v3 ----------------------------------------------
create or replace function cs.fn_tag_hm_origem(p_comprador_id uuid)
returns text                       -- público aplicado: 'Aurum' | 'HM' | 'Novo'
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_card       record;
  al           record;
  v_na_base    boolean := false;
  v_publico    text;
  v_canal      text;
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

  -- Data do sinal: define a janela do evento pontual (item "c" da regra).
  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_dt
    from public.compras c
   where c.comprador_id = p_comprador_id
     and c.oferta_codigo = 'z391kxd9'
     and c.status in ('APPROVED','COMPLETE','COMPLETED');

  -- Quem a pessoa É — a base de alunos é a fonte da verdade.
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

  if not v_na_base then
    v_publico := 'Novo';
  else
    v_turma_thb := nullif(trim(al.turma_codigo), '');
    v_turma_aur := nullif(trim(al.turma_aurum), '');
    if al.espaco_instrucao = 'aurum' or al.turma_aurum_id is not null then
      v_publico := 'Aurum';
    else
      v_publico := 'HM';
    end if;
  end if;

  -- POR ONDE ENTROU (canal) — fato, nunca o texto da oferta.
  if v_na_base then
    -- A oferta foi feita para a base. Ter comprado ingresso do HT não muda isso.
    v_canal := 'HM - Programa de Implementação';
  else
    v_canal := cs.fn_hm_edicao_ht(p_comprador_id);          -- 'HT28', 'HT27'…
    if v_canal is null and v_dt is not null then
      if v_dt >= '2026-06-25 00:00:00-03' and v_dt < '2026-06-27 00:00:00-03' then
        v_canal := 'Live Direto ao Ponto';
      elsif v_dt >= '2026-07-06 00:00:00-03' and v_dt < '2026-07-08 00:00:00-03' then
        v_canal := 'HT ATM';                                 -- evento de 06 e 07/07
      end if;
    end if;
  end if;

  v_novas := array_remove(array[v_publico, v_canal, v_turma_thb, v_turma_aur], null);
  update cs.contatos_hm
     set tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(tags, '{}') || v_novas) t),
         atualizado_em = now()
   where id = v_card.id;

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
$function$;

-- 3) O texto da oferta deixa de afirmar um canal ------------------------------
-- "Sinal R$300 (ofertado no evento HT ATM)" era exibido como subtítulo do card e
-- é o que induzia o operador ao erro. A oferta é a mesma em todos os canais.
update public.hm_product_catalog
   set notes = 'Sinal R$300 (entrada do HM)'
 where offer_code = 'z391kxd9';

update cs.contatos_hm
   set plano = 'Sinal R$300 (entrada do HM)', atualizado_em = now()
 where plano ilike '%ofertado no evento HT ATM%';

-- 4) Reprocessa todos os cards ------------------------------------------------
-- Limpa APENAS as tags gerenciadas por esta lógica (preserva "No grupo",
-- "Respondeu qualificação" e demais tags externas) e reaplica pela regra nova.
do $reprocessa$
declare
  r record;
begin
  update cs.contatos_hm ch
     set tags = (
       select coalesce(array_agg(t), '{}')
         from unnest(ch.tags) t
        where t not in ('HT ATM','Aurum','HM','Novo','Live Direto ao Ponto','HM - Programa de Implementação')
          and t !~ '^HT[0-9]+$'
          and t not in (select codigo from public.thb_turmas)
     );

  for r in select comprador_id from cs.contatos_hm loop
    begin
      perform cs.fn_tag_hm_origem(r.comprador_id);
    exception when others then
      null;  -- um card mal classificado não pode abortar o reprocessamento
    end;
  end loop;
end$reprocessa$;
