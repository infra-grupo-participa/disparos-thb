-- 0208 — "Reclamada" é PEDIDO de reembolso; só "Reembolsado" é reembolso FEITO.
--
-- ── O PEDIDO (Marcio, 12/08/2026) ───────────────────────────────────────────────
--   "Tem o reembolsado e o reclamado. Ambos têm diferença porque um é direto quando
--    ele faz o reembolso pela Hotmart e confirma que ele fez o reembolso. Agora
--    quando ele está reclamado significa que, pela reunião ou, enfim, em algum tipo
--    de comunicação, o cliente solicitou o início do processo de reembolso."
--
-- ── O BUG: o alerta tratava os dois como a mesma coisa ──────────────────────────
-- `cs.fn_hm_health_check` gravava 'reembolso_sem_baixa' para:
--
--     where e.chave in ('hm_cancelamento','hm_reembolsado')
--       and exists (compra APPROVED) and not exists (compra REFUNDED/...)
--
-- Para 'hm_reembolsado' o alerta está CERTO: o reembolso foi executado, então a
-- compra não deveria seguir aprovada — se segue, o razão conta como recebido um
-- dinheiro que voltou.
--
-- Para 'hm_cancelamento' ("Reclamada") o alerta está ERRADO **por construção**:
-- o cliente apenas PEDIU o reembolso; a Hotmart ainda não devolveu nada. A compra
-- continuar APPROVED é o estado CORRETO e esperado. O alerta chamava de problema
-- exatamente o comportamento normal do processo.
--
-- Efeito medido em 12/08: dos 14 alertas abertos, **13 eram "Reclamada"** (falso
-- positivo) e só 1 era "Reembolsado" (Ely Takeuti, R$ 300 — divergência real).
-- 93% de ruído. Alerta que grita sem motivo treina o time a ignorar o painel —
-- e aí o 1 que importa passa junto com os 13.
--
-- Detalhe que confirma o diagnóstico: `hotmart_cancelado_em` é NULL nos 14. A
-- Hotmart nunca confirmou cancelamento nenhum; quem moveu o card foi GENTE, a
-- partir da conversa com o cliente. É exatamente o que o Marcio descreveu.
--
-- ── O resto do sistema JÁ sabia da diferença ────────────────────────────────────
-- Só o alerta não sabia:
--   · app/hm/kanban/page.tsx:132 — `COL_CANCELAMENTO` comentado como
--     "'Reclamada' — o cliente PEDIU o cancelamento"
--   · app/hm/kanban/page.tsx:1104 — "O PEDIDO: só move para 'Reclamada'. O acesso
--     continua valendo."
--   · app/_components/ajuda.tsx:385 — "Reclamada é o pedido de cancelamento;
--     Reembolsado é o reembolso executado."
-- ➡️ Quando a UI e o alerta discordam sobre o significado de uma coluna, é o
--    alerta que costuma estar desatualizado — ele é escrito uma vez e não é lido
--    todo dia por quem opera.

create or replace function cs.fn_hm_health_check()
 returns table(tipo text, novos integer, abertos integer)
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
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

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'sem_canal', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' sem canal de aquisição (rodar cs.fn_sync_hm_atm ou conferir oferta de entrada).'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
   where not exists (
     select 1 from unnest(coalesce(ch.tags,'{}')) t
      where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta','Renovação'])
         or t ~ '^HT[0-9]+$'
         or t in (select canal from cs.hm_evento_janela))
   on conflict do nothing;

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

  -- ⬇️ A MUDANÇA DESTA MIGRATION: só 'hm_reembolsado'.
  -- "Reclamada" (hm_cancelamento) saiu daqui — lá o cliente só PEDIU, o dinheiro
  -- não voltou, e a compra seguir aprovada é o certo. Ver o cabeçalho.
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'reembolso_sem_baixa', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' está em "Reembolsado" (reembolso EXECUTADO) mas a compra '||
         'segue aprovada no banco — a baixa não chegou e o razão conta como recebido. Conferir na Hotmart.'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
    join cs.estagios e on e.id = ch.estagio_id
   where e.chave = 'hm_reembolsado'
     and exists (select 1 from public.compras c
                  where c.comprador_id = ch.comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED'))
     and not exists (select 1 from public.compras c
                  where c.comprador_id = ch.comprador_id and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
   on conflict do nothing;

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
                          or t ~ '^HT[0-9]+$'
                          or t in (select canal from cs.hm_evento_janela)));

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='boleto_preso'
     and not exists (select 1 from public.compras co
                      where co.hotmart_transaction = a.chave and co.status in ('BILLET_PRINTED','PRINTED_BILLET'));

  -- Resolução espelha o novo critério: sai da lista quem baixou o reembolso OU
  -- quem não está mais em "Reembolsado" (incluindo quem só está em "Reclamada" —
  -- é assim que os 13 falsos positivos se auto-resolvem na próxima rodada).
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='reembolso_sem_baixa'
     and (exists (select 1 from public.compras c
                   where c.comprador_id::text = a.chave and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
          or not exists (select 1 from cs.contatos_hm ch join cs.estagios e on e.id=ch.estagio_id
                          where ch.comprador_id::text = a.chave and e.chave = 'hm_reembolsado'));

  return query
    select a.tipo, count(*) filter (where a.detectado_em > now()-interval '1 min')::int as novos,
           count(*) filter (where a.resolvido_em is null)::int as abertos
    from cs.hm_alertas a group by a.tipo;
end$function$;

comment on function cs.fn_hm_health_check() is
  '0208: alerta reembolso_sem_baixa cobre SÓ "Reembolsado" (reembolso executado). "Reclamada" é PEDIDO de reembolso em andamento — a compra seguir aprovada lá é o estado correto, e alertar sobre isso gerava 13 falsos positivos em 14 (12/08/2026).';
