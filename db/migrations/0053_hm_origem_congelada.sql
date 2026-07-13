-- =====================================================================
-- 0053_hm_origem_congelada
-- A base de alunos é a fonte da verdade sobre QUEM a pessoa é — mas ela é
-- reescrita pelo próprio funil do HM, e isso estava corrompendo a origem.
--
-- Dois efeitos colaterais do provisionamento (0043/0049/0050/0051):
--   1) o lead NOVO que quita vira linha em thb_alunos (fonte 'sip_ativacao_hm').
--      Na classificação seguinte ele deixa de ser "Novo" e passa a "aluno da
--      base" — foi o que aconteceu com Laura Cardoso, que virou aluna HM e
--      ganhou o canal "Programa de Implementação" quando na verdade é lead novo
--      vindo do ingresso da HT28;
--   2) o ex-aluno que quita tem `turma_id` MOVIDA para a T39 (ele agora é da
--      turma nova). A turma de ORIGEM — T29, T6, T34 — some da base, e com ela
--      a informação de qual turma o comercial estava trabalhando.
--
-- A origem tem que ser fotografada na ENTRADA e nunca mais mudar:
--   • `turma_origem` (coluna nova) congela a turma que a pessoa tinha quando
--     entrou no funil. É dela que sai a tag de turma — não mais da base viva.
--   • a busca na base passa a IGNORAR os cadastros nascidos do próprio HM
--     ('sip_ativacao_hm', 'webhook_hotmart_hm'), senão o funil "promove" o
--     lead novo a aluno antigo dele mesmo.
--   • T39 nunca é tag de turma: é a turma DESTE programa, não a de origem.
--
-- A turma de origem dos cards já provisionados é recuperada do marcador
-- ⟦HM origem⟧ gravado nas observações na primeira classificação ("THB T29").
-- Aditiva e idempotente.
-- =====================================================================

-- 1) A turma de origem passa a viver no card ---------------------------------
alter table cs.contatos_hm add column if not exists turma_origem text;

-- Recupera do que foi gravado antes do provisionamento sobrescrever a base.
update cs.contatos_hm
   set turma_origem = (regexp_match(observacoes, 'THB (T[0-9.]+)'))[1]
 where turma_origem is null
   and observacoes ~ 'THB T[0-9]';

-- 2) Classificação v4 — origem congelada, base como referência ----------------
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
  select ch.id, ch.tags, ch.observacoes, ch.turma_origem,
         lower(trim(cmp.email)) as email,
         right(regexp_replace(coalesce(cmp.telefone, ''), '[^0-9]', '', 'g'), 10) as tel10
    into v_card
    from cs.contatos_hm ch
    join public.compradores cmp on cmp.id = ch.comprador_id
   where ch.comprador_id = p_comprador_id;
  if not found then
    return null;
  end if;

  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_dt
    from public.compras c
   where c.comprador_id = p_comprador_id
     and c.oferta_codigo = 'z391kxd9'
     and c.status in ('APPROVED','COMPLETE','COMPLETED');

  -- Quem a pessoa É — ignorando O CADASTRO DA T39 que o próprio funil criou.
  -- O filtro é a combinação (fonte do funil + turma T39), não a fonte sozinha:
  --   • Laura — sip_ativacao_hm + T39  → cadastro que nós criamos: ignora (é lead novo);
  --   • Pedro — webhook_hotmart_hm + T5 → aluno de verdade, comprou em abril: conta;
  --   • Tomé  — planilha_acessos + T39  → aluno antigo que o provisionamento MOVEU
  --     para a T39: conta (e a turma real, T29, vem congelada de `turma_origem`).
  -- Sem isso, todo lead novo que quita vira "aluno da base" no instante seguinte
  -- e o canal dele é reescrito para "Programa de Implementação".
  select v.turma_codigo, v.turma_aurum_id, ta.codigo as turma_aurum, v.espaco_instrucao,
         v.profissao, v.cidade, v.estado, v.eh_socio
    into al
    from public.vw_aluno_360 v
    left join public.thb_turmas ta on ta.id = v.turma_aurum_id
   where not (coalesce(v.fonte, '') in ('sip_ativacao_hm', 'webhook_hotmart_hm')
              and coalesce(v.turma_codigo, '') = 'T39')
     and (v.comprador_id = p_comprador_id
      or (v.email is not null and lower(trim(v.email)) = v_card.email and v_card.email <> '')
      or (length(v_card.tel10) = 10
          and right(regexp_replace(coalesce(v.telefone_e164, v.telefone, ''), '[^0-9]', '', 'g'), 10) = v_card.tel10))
   order by (v.comprador_id = p_comprador_id) desc nulls last,
            (lower(trim(v.email)) = v_card.email) desc nulls last
   limit 1;
  v_na_base := found;

  if not v_na_base then
    v_publico := 'Novo';
  else
    -- A turma de origem é fotografada na primeira classificação e nunca mais
    -- muda: depois do pagamento, a base moveria a pessoa para a T39 e a turma
    -- que interessa ao comercial (de onde ela veio) se perderia.
    -- T39 é a turma DESTE programa — nunca é turma de origem.
    v_turma_thb := coalesce(v_card.turma_origem, nullif(nullif(trim(al.turma_codigo), ''), 'T39'));
    v_turma_aur := nullif(trim(al.turma_aurum), '');
    if al.espaco_instrucao = 'aurum' or al.turma_aurum_id is not null then
      v_publico := 'Aurum';
    else
      v_publico := 'HM';
    end if;

    if v_card.turma_origem is null and v_turma_thb is not null then
      update cs.contatos_hm set turma_origem = v_turma_thb where id = v_card.id;
    end if;
  end if;

  -- POR ONDE ENTROU (canal) — fato, nunca o texto da oferta.
  if v_na_base then
    v_canal := 'HM - Programa de Implementação';   -- a oferta foi feita para a base
  else
    v_canal := cs.fn_hm_edicao_ht(p_comprador_id); -- 'HT28', 'HT27'… (ingresso do HT)
    if v_canal is null and v_dt is not null then
      if v_dt >= '2026-06-25 00:00:00-03' and v_dt < '2026-06-27 00:00:00-03' then
        v_canal := 'Live Direto ao Ponto';
      elsif v_dt >= '2026-07-06 00:00:00-03' and v_dt < '2026-07-08 00:00:00-03' then
        v_canal := 'HT ATM';                        -- evento de 06 e 07/07
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

-- 3) Reprocessa: limpa as tags gerenciadas e reaplica pela regra congelada -----
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
