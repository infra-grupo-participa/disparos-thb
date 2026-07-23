-- =====================================================================
-- 0128_hm_health_check_conhece_renovacao
--
-- Conserta falso positivo introduzido pela 0127: o monitor de saúde
-- (cs.fn_hm_health_check, bloco "sem_canal") tinha a lista de canais
-- hardcoded e não conhecia o canal 'Renovação' (par de 'Acesso ETHB',
-- oferta 6qxsk9kq). Resultado: Cristiano e Leonardo — que TÊM canal
-- 'Renovação' — eram marcados como "sem canal".
--
-- Dois consertos:
--   (1) 'Renovação' entra na lista de canais válidos do bloco 3.
--   (2) auto-resolve para 'sem_canal' (antes só 'card_faltando' fechava
--       sozinho → alertas de canal ficavam acesos para sempre depois de
--       resolvidos).
-- No fim, fecha os 2 alertas atuais (já estão corretos no banco).
-- =====================================================================

create or replace function cs.fn_hm_health_check()
 returns table(tipo text, novos integer, abertos integer)
 language plpgsql security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
  -- 1) OFERTA ÓRFÃ: oferta de produto HM aprovada e fora do catálogo (pagamento evapora)
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

  -- 2) CARD FALTANDO: comprador com compra HM (sinal/compra_cheia/diferenca) aprovada
  --    após o cutoff, sem card — considerando alias (o gêmeo usa o card do canônico)
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

  -- 3) SEM CANAL: card sem nenhuma tag de canal (inclui 'Renovação', 0127)
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'sem_canal', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' sem canal de aquisição (rodar cs.fn_sync_hm_atm ou conferir oferta de entrada).'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
   where not exists (
     select 1 from unnest(coalesce(ch.tags,'{}')) t
      where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta','Renovação'])
         or t ~ '^HT[0-9]+$')
   on conflict do nothing;

  -- 4) DUPLICADO: mesma pessoa (CPF) com 2+ compradores ligados ao HM, ainda não aliasada
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

  -- Auto-resolve: fecha alertas cujo problema sumiu
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='card_faltando'
     and exists (select 1 from cs.contatos_hm ch where ch.comprador_id::text = a.chave);

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='sem_canal'
     and exists (
       select 1 from cs.contatos_hm ch
        where ch.comprador_id::text = a.chave
          and exists (select 1 from unnest(coalesce(ch.tags,'{}')) t
                       where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta','Renovação'])
                          or t ~ '^HT[0-9]+$'));

  return query
    select a.tipo, count(*) filter (where a.detectado_em > now()-interval '1 min')::int as novos,
           count(*) filter (where a.resolvido_em is null)::int as abertos
    from cs.hm_alertas a group by a.tipo;
end$function$;

-- roda o check já com a lógica corrigida (fecha os 2 falsos positivos)
select * from cs.fn_hm_health_check();
