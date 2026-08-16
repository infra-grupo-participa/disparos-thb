-- 0238_eixo_programa_na_tag.sql
-- O card passa a dizer EM QUE PROGRAMA a pessoa está.
--
-- Regra do Marcio (14/08/2026):
--   · quem comprou o sinal (R$ 300 ou R$ 697) está no Programa de Implementação;
--   · quem pagou os R$ 15.000 direto também está — mas só se pagou MESMO;
--   · aluno da base que nunca comprou o programa novo e pagou a renovação (~R$ 2.000)
--     fica no programa antigo.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA TAG NÃO EXISTIA (e por que o board parecia mentir)
--
-- `HM - Programa de Implementação` **é um CANAL**, não um programa. Na escada de
-- `cs.fn_tag_hm_origem` ela significa "entrou pela oferta feita para a base, fora de
-- evento" — irmã de `HT ATM`, `Live Direto ao Ponto`, `HT29 - 26-07`. Por isso só 88
-- cards a têm enquanto **204 compraram o sinal**: os outros 116 entraram por um evento
-- e ganharam o canal do evento, não este.
--
-- Nada estava errado. Faltava a pergunta: as tags respondiam "por onde entrou" e
-- "o que era antes", nunca "em que programa está agora". Este eixo responde.
--
-- ---------------------------------------------------------------------------
-- MEDIDO ANTES DE APLICAR (14/08/2026, 264 cards HM)
--   · Programa: Implementação ............ 250   (sinal 204 + compra cheia 3 + demais ofertas de esteira)
--   · Programa: Renovação ..................  1
--   · Programa: Legado .....................  5
--   · sem classificação ....................  8   ← listados no aviso do fim; nenhum recebe tag
--
-- ADITIVO: cria um eixo novo. NÃO renomeia `Aluno THB`, `Turma T39`, `Origem T30` nem
-- os canais — renomear aqueles mexe em `fn_tag_hm_origem`, `fn_sync_hm_atm`,
-- `fn_hm_health_check` e na régua `CANAIS_FIXOS` do front ao mesmo tempo (a armadilha
-- da 0128: canal novo exige atualizar TODA lista hardcoded). Isso vai na 0239, junto
-- com o front, para não deixar o board recortado no meio do dia.
--
-- Escreve só em `cs.contatos_hm.tags`. Não toca estágio, responsável, pagamento nem
-- `public.thb_alunos`. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) A regra, em um lugar só
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_programa(p_comprador_id uuid)
 returns text
 language sql
 stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  with compra as (
    select cat.categoria, k.preco
      from public.compras k
      join public.hm_product_catalog cat on cat.offer_code = k.oferta_codigo
     where k.comprador_id = p_comprador_id
       and k.status in ('APPROVED','COMPLETE','COMPLETED')
  ), esteira as (
    -- entrou no programa NOVO: pagou o sinal, ou pagou o pacote inteiro de uma vez.
    -- `compra_cheia` só conta com dinheiro de verdade no razão — a decisão do Marcio
    -- foi "tem que ver se ela pagou os 15 mil direto", não confiar no rótulo da oferta.
    select exists (
      select 1 from compra c
       where c.categoria = 'sinal'
          or (c.categoria = 'compra_cheia'
              and exists (select 1 from cs.hm_pagamentos p
                           where p.comprador_id = p_comprador_id
                             and p.categoria in ('compra_cheia','saldo','mensalidade')))
    ) as sim
  ), renov as (
    select exists (select 1 from compra c where c.categoria in ('renovacao','reserva')) as sim
  ), base as (
    -- aluno de turma anterior de verdade: ignora o registro que o próprio sinal cria
    -- (`sip_sinal_trilha` e irmãos), senão todo lead novo vira "aluno antigo" — foi o
    -- que a 0125 já tinha consertado no eixo de público.
    select exists (
      select 1 from public.vw_aluno_360 v
       where coalesce(v.fonte,'') not in ('sip_ativacao_hm','webhook_hotmart_hm','sip_sinal_trilha')
         and (v.comprador_id = p_comprador_id
           or exists (select 1 from public.compradores cp
                       where cp.id = p_comprador_id
                         and (lower(trim(cp.email)) = lower(trim(v.email))
                           or (length(regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g')) >= 11
                               and regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g')
                                 = regexp_replace(coalesce(v.documento,''),'[^0-9]','','g')))))
    ) as sim
  )
  select case
           when (select sim from esteira) then 'Programa: Implementação'
           when (select sim from renov)   then 'Programa: Renovação'
           when (select sim from base)    then 'Programa: Legado'
           else null
         end;
$function$;

comment on function cs.fn_hm_programa(uuid) is
  '0238: em que PROGRAMA a pessoa esta hoje (Implementacao | Renovacao | Legado), '
  'diferente do CANAL por onde ela entrou. Implementacao = pagou sinal ou pagou o pacote '
  'cheio com dinheiro no razao. Legado = aluno de turma anterior que nunca comprou o novo. '
  'NULL = nao da para afirmar — melhor sem tag do que com tag errada.';

-- ---------------------------------------------------------------------------
-- 2) Carimba o eixo, limpando só ele
--
-- Remove qualquer `Programa: *` antigo antes de recarimbar: sem isso, mudar de
-- Legado para Implementação deixaria as duas tags no card e o operador leria as duas.
-- ---------------------------------------------------------------------------
update cs.contatos_hm ch
   set tags = (
     select coalesce(array_agg(t order by t), '{}')
       from (
         select t from unnest(ch.tags) t where t not like 'Programa: %'
         union
         select cs.fn_hm_programa(ch.comprador_id) where cs.fn_hm_programa(ch.comprador_id) is not null
       ) x(t)
   )
 where ch.produto = 'HM'
   and (select coalesce(array_agg(t order by t), '{}')
          from (select t from unnest(ch.tags) t where t not like 'Programa: %'
                union
                select cs.fn_hm_programa(ch.comprador_id) where cs.fn_hm_programa(ch.comprador_id) is not null) x(t))
       is distinct from ch.tags;

-- ---------------------------------------------------------------------------
-- 3) Verificação — o eixo é exclusivo e ninguém fica com dois programas
-- ---------------------------------------------------------------------------
do $$
declare
  v_impl int; v_renov int; v_leg int; v_sem int; v_duplo int; v_nomes text;
begin
  select count(*) filter (where 'Programa: Implementação' = any(tags)),
         count(*) filter (where 'Programa: Renovação'     = any(tags)),
         count(*) filter (where 'Programa: Legado'        = any(tags)),
         count(*) filter (where not exists (select 1 from unnest(tags) t where t like 'Programa: %'))
    into v_impl, v_renov, v_leg, v_sem
    from cs.contatos_hm where produto = 'HM';

  select count(*) into v_duplo
    from cs.contatos_hm
   where produto='HM'
     and (select count(*) from unnest(tags) t where t like 'Programa: %') > 1;
  if v_duplo > 0 then
    raise exception '0238: % cards ficaram com mais de um Programa. O eixo tem que ser exclusivo.', v_duplo;
  end if;

  if v_impl < 200 then
    raise exception '0238: só % em Programa: Implementação — esperado ~250. A regra do sinal não pegou; conferir hm_product_catalog antes de seguir.', v_impl;
  end if;

  -- quem ficou sem programa vira lista nominal, nunca silêncio
  select string_agg(cp.nome || ' <' || cp.email || '>', '; ')
    into v_nomes
    from cs.contatos_hm ch join public.compradores cp on cp.id = ch.comprador_id
   where ch.produto='HM'
     and not exists (select 1 from unnest(ch.tags) t where t like 'Programa: %');
  if v_nomes is not null then
    raise notice '0238: SEM programa (nenhuma compra da esteira, nenhuma renovação, não é aluno de turma anterior) — conferir um a um: %', v_nomes;
  end if;

  raise notice '0238: Implementação % · Renovação % · Legado % · sem programa %', v_impl, v_renov, v_leg, v_sem;
end $$;
