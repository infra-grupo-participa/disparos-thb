-- =====================================================================
-- 0131_hm_monitor_reconciliacao_compras
--
-- Estende o vigia diário (cs.fn_hm_health_check, cron hm-health-check-diario
-- 07h) com 2 detectores que pegam — SEM depender do CSV da Hotmart — os
-- padrões achados na reconciliação de 23/07 (ver [[HM - Reconciliacao Hotmart x banco]]):
--
--   * boleto_preso: compra em BILLET_PRINTED/PRINTED_BILLET há >10 dias e sem
--     nenhuma transação aprovada da mesma oferta. Boleto vence em ~3 dias; se
--     segue "impresso" há tanto tempo, ou COMPENSOU e o webhook não atualizou
--     (pagamento invisível — caso Rafael Bayard) ou EXPIROU e não baixou. O
--     operador confere na Hotmart e o status é corrigido.
--   * reembolso_sem_baixa: card em cancelamento/reembolso mas TODAS as compras
--     do comprador seguem aprovadas — reembolso/chargeback que não deu baixa no
--     status (razão conta como recebido — casos Fernando/Jonas/Sherrine/Marília).
--
-- Ambos com auto-resolve. Causa-raiz definitiva é no webhook (outro repo):
-- eventos de MUDANÇA de estado (boleto pago, refund, chargeback, expirado)
-- precisam fazer UPDATE do status em public.compras.
-- =====================================================================

create or replace function cs.fn_hm_health_check()
 returns table(tipo text, novos integer, abertos integer)
 language plpgsql security definer
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

  -- 2) CARD FALTANDO
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
      where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta','Renovação'])
         or t ~ '^HT[0-9]+$')
   on conflict do nothing;

  -- 4) DUPLICADO
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

  -- 5) BOLETO PRESO: impresso há >10 dias, sem transação aprovada da mesma oferta.
  --    Ou compensou e o webhook não atualizou (pagamento invisível), ou expirou.
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'boleto_preso', co.hotmart_transaction, 'aviso',
         'Boleto de '||cp.email||' ('||co.oferta_codigo||') impresso em '||
         to_char(coalesce(co.data_compra,co.criado_em),'DD/MM')||' e parado há '||
         (now()::date - coalesce(co.data_compra,co.criado_em)::date)||
         ' dias — conferir na Hotmart: se PAGOU, atualizar status (pagamento invisível); se EXPIROU, baixar.'
    from public.compras co
    join public.compradores cp on cp.id = co.comprador_id
   where co.produto_id in ('5064314','3507214')
     and co.status in ('BILLET_PRINTED','PRINTED_BILLET')
     and coalesce(co.data_compra,co.criado_em) < now() - interval '10 days'
     and not exists (
       select 1 from public.compras c2
        where c2.comprador_id = co.comprador_id and c2.oferta_codigo = co.oferta_codigo
          and c2.status in ('APPROVED','COMPLETE','COMPLETED'))
   on conflict do nothing;

  -- 6) REEMBOLSO SEM BAIXA: card em cancelamento/reembolso, mas todas as compras
  --    do comprador seguem aprovadas (o refund/chargeback não atualizou o status).
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'reembolso_sem_baixa', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' está em "'||e.nome||'" mas a compra segue aprovada no banco — '||
         'reembolso/chargeback pode não ter dado baixa (razão conta como recebido). Conferir na Hotmart.'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
    join cs.estagios e on e.id = ch.estagio_id
   where e.chave in ('hm_cancelamento','hm_reembolsado')
     and exists (select 1 from public.compras c
                  where c.comprador_id = ch.comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED'))
     and not exists (select 1 from public.compras c
                  where c.comprador_id = ch.comprador_id and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
   on conflict do nothing;

  -- ================= AUTO-RESOLVE =================
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

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='boleto_preso'
     and not exists (select 1 from public.compras co
                      where co.hotmart_transaction = a.chave and co.status in ('BILLET_PRINTED','PRINTED_BILLET'));

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='reembolso_sem_baixa'
     and (exists (select 1 from public.compras c
                   where c.comprador_id::text = a.chave and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
          or not exists (select 1 from cs.contatos_hm ch join cs.estagios e on e.id=ch.estagio_id
                          where ch.comprador_id::text = a.chave and e.chave in ('hm_cancelamento','hm_reembolsado')));

  return query
    select a.tipo, count(*) filter (where a.detectado_em > now()-interval '1 min')::int as novos,
           count(*) filter (where a.resolvido_em is null)::int as abertos
    from cs.hm_alertas a group by a.tipo;
end$function$;

select * from cs.fn_hm_health_check();
