-- =====================================================================
-- 0122_hm_monitor_saude
--
-- Quadro de saúde do HM: detecta sozinho os problemas que já morderam
-- (oferta fora do catálogo → pagamento evapora; comprador aprovado sem card;
-- card sem canal; mesma pessoa com 2 cadastros/duplicado) e registra em
-- cs.hm_alertas. Um cron diário roda a checagem. O Slack (edge report-slack,
-- outro repo) e/ou a tela só precisam ler `select * from cs.hm_alertas
-- where resolvido_em is null`. Detecção 100% no banco, idempotente.
-- =====================================================================

create table if not exists cs.hm_alertas (
  id           bigint generated always as identity primary key,
  tipo         text not null,          -- oferta_orfa | card_faltando | sem_canal | duplicado
  chave        text not null,          -- identificador do caso (oferta, comprador, cpf)
  severidade   text not null default 'alerta',
  detalhe      text,
  detectado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create unique index if not exists hm_alertas_aberto_uniq
  on cs.hm_alertas (tipo, chave) where resolvido_em is null;

create or replace function cs.fn_hm_health_check()
 returns table(tipo text, novos int, abertos int)
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
  -- 1) OFERTA ÓRFÃ
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'oferta_orfa', coalesce(c.oferta_codigo,'(nula)'), 'critico',
         'Oferta '||coalesce(c.oferta_codigo,'(nula)')||' fora do catálogo — '||count(*)||
         ' compra(s) aprovada(s); pagamento não vira card/razão. Cadastrar em hm_product_catalog.'
    from public.compras c
   where c.produto_id in ('5064314','3507214')
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and not exists (select 1 from public.hm_product_catalog cat where cat.offer_code = c.oferta_codigo)
   group by c.oferta_codigo
   on conflict do nothing;

  -- 2) CARD FALTANDO (considera alias)
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'card_faltando', c.comprador_id::text, 'critico',
         'Comprador '||cp.email||' pagou ('||string_agg(distinct cat.categoria,'/')||') e não tem card na esteira.'
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
    join public.compradores cp on cp.id = c.comprador_id
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia','diferenca')
     and coalesce(c.data_aprovacao, c.data_compra) >= v_cutoff
     and not exists (
       select 1 from cs.contatos_hm ch
        where ch.comprador_id = coalesce(
          (select canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
          c.comprador_id))
   group by c.comprador_id, cp.email
   on conflict do nothing;

  -- 3) SEM CANAL
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'sem_canal', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' sem canal de aquisição (rodar cs.fn_sync_hm_atm ou conferir oferta de entrada).'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
   where not exists (
     select 1 from unnest(coalesce(ch.tags,'{}')) t
      where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta'])
         or t ~ '^HT[0-9]+$')
   on conflict do nothing;

  -- 4) DUPLICADO (CPF com 2+ cadastros HM não aliasados)
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'duplicado', doc, 'aviso', 'CPF '||doc||' com 2+ cadastros na Hotmart ('||string_agg(distinct email,' / ')||') — conferir alias.'
    from (
      select regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g') doc, lower(trim(cp.email)) email
        from public.compradores cp
       where (exists (select 1 from cs.contatos_hm ch where ch.comprador_id=cp.id)
              or exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code=c.oferta_codigo
                          where c.comprador_id=cp.id and c.status in ('APPROVED','COMPLETE','COMPLETED')))
         and not exists (select 1 from cs.hm_comprador_alias a where a.comprador_id=cp.id)
         and length(regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g'))=11
    ) x
   group by doc
   having count(distinct email) > 1
   on conflict do nothing;

  -- Auto-resolve card_faltando que ganhou card
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='card_faltando'
     and exists (select 1 from cs.contatos_hm ch where ch.comprador_id::text = a.chave);

  return query
    select a.tipo, count(*) filter (where a.detectado_em > now()-interval '1 min')::int as novos,
           count(*) filter (where a.resolvido_em is null)::int as abertos
    from cs.hm_alertas a group by a.tipo;
end$function$;

select cron.schedule('hm-health-check-diario', '0 7 * * *', $$ select cs.fn_hm_health_check(); $$);
