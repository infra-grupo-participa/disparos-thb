-- =====================================================================
-- 0113_saude_financeiro_cobre_conciliacao
--
-- Durante a apuração de 20/07/2026 (comercial × financeiro), fn_fin_saude()
-- devolvia VERDE — nenhuma linha — enquanto existiam quatro problemas reais:
-- crédito pró-rata contado em dobro, cache do razão dessincronizado, 21 falsos
-- órfãos e pagamento sem destino parado há 25 dias. As 5 checagens existentes
-- simplesmente não olhavam para lá. Selo verde que não cobre o buraco é pior
-- que selo nenhum: dá confiança onde não há.
--
-- Acrescenta 4 checagens. Mantém as 5 originais intactas.
-- Assinatura preservada: (check_id text, label text, valor int, ok boolean).
-- =====================================================================

create or replace function public.fn_fin_saude()
returns table (check_id text, label text, valor int, ok boolean)
language sql
security definer
set search_path = public, cs
as $$
  WITH checks AS (
    SELECT 'ofertas_orfas' AS check_id, 'Ofertas fora do catálogo' AS label,
      (SELECT count(*) FROM (SELECT c.oferta_codigo FROM public.compras c
         LEFT JOIN public.hm_product_catalog cat ON cat.offer_code=c.oferta_codigo
         WHERE c.produto_id IN ('5064314','3507214') AND c.status IN ('APPROVED','COMPLETE','COMPLETED')
           AND cat.offer_code IS NULL GROUP BY c.oferta_codigo) x)::int AS valor
    UNION ALL SELECT 'cascata_incompleta', 'Compras sem "cliente pagou"',
      (SELECT count(*) FROM public.compras WHERE produto_id='5064314'
         AND status IN ('APPROVED','COMPLETE','COMPLETED') AND preco IS NOT NULL AND valor_com_impostos IS NULL)::int
    UNION ALL SELECT 'reserva_na_razao', 'Reserva/renovação indevida na razão',
      (SELECT count(*) FROM cs.hm_pagamentos p JOIN public.hm_product_catalog cat ON cat.offer_code=p.oferta_codigo
         WHERE cat.categoria IN ('reserva','renovacao'))::int
    UNION ALL SELECT 'saldo_sem_ficha', 'Pagou saldo mas sem ficha de aluno',
      (SELECT count(*) FROM cs.contatos_hm ch WHERE ch.aluno_id IS NULL
         AND EXISTS(SELECT 1 FROM cs.hm_pagamentos p WHERE p.comprador_id=ch.comprador_id
                    AND p.categoria IN ('saldo','mensalidade','compra_cheia','diferenca')))::int
    UNION ALL SELECT 'quitado_com_saldo', 'Quitado mas com saldo aberto',
      (SELECT count(*) FROM cs.vw_fin_contas_receber WHERE status_financeiro='quitado' AND saldo_a_pagar > 1)::int

    -- ---- novas (0113) ----

    -- O falso-verde: pacote cravado ignorando o crédito pró-rata, e o pagamento
    -- que virou esse crédito ainda somado como pagamento. Saldo zero por
    -- coincidência aritmética. Board e financeiro mostram "quitado" sem quitação.
    UNION ALL SELECT 'credito_duplo', 'Crédito pró-rata contado em dobro',
      (SELECT count(*) FROM cs.vw_hm_credito_duplo)::int

    -- cs.contatos_hm.valor_pago é CACHE de cs.hm_pagamentos (razão = verdade).
    -- Quando deriva, o board mostra um número e o financeiro outro — o v2 lê o
    -- razão direto, o board lê o cache.
    UNION ALL SELECT 'cache_dessincronizado', 'Cache de pago fora do razão',
      (SELECT count(*) FROM cs.contatos_hm ch
        LEFT JOIN (SELECT comprador_id, coalesce(sum(valor),0) s
                     FROM cs.hm_pagamentos GROUP BY 1) r ON r.comprador_id = ch.comprador_id
        WHERE abs(coalesce(r.s,0) - coalesce(ch.valor_pago,0)) > 0.01)::int

    -- Dinheiro aprovado que não achou destino (renovação sem aluno, oferta
    -- desconhecida, sem_destino). Se isto passa de zero, alguém pagou e sumiu.
    UNION ALL SELECT 'pagamento_sem_destino', 'Pagamento aprovado sem destino',
      (SELECT count(*) FROM cs.vw_pagamentos_sem_destino)::int

    -- Pagamento HM pós-cutoff cujo dono não tem card na esteira.
    UNION ALL SELECT 'pagamento_orfao', 'Pagou e não abriu card',
      (SELECT count(*) FROM cs.vw_hm_pagamentos_orfaos)::int
  )
  SELECT check_id, label, valor, valor=0 FROM checks
  WHERE public.gp_pode_ver_financeiro()
  ORDER BY valor=0, check_id;
$$;

comment on function public.fn_fin_saude() is
  'Checagens ao vivo do financeiro HM. 9 desde 0113: as 4 últimas nasceram da apuração '
  'comercial × financeiro de 20/07/2026, quando a função devolvia verde com quatro '
  'problemas reais em aberto.';

revoke all on function public.fn_fin_saude() from public;
grant execute on function public.fn_fin_saude() to authenticated;
