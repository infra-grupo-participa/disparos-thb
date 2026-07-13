-- =====================================================================
-- 0044_cs_hm_sugestao_financeira
-- Sugestão de valores para o formulário de pagamento do HM (0043).
--
-- Existe como função porque a ficha roda com o papel `disparos_app`, que NÃO
-- tem select em public.compras nem em public.hm_product_catalog (ambas com RLS
-- e sem grant). Ler essas tabelas direto da rota daria permission denied — a
-- função é SECURITY DEFINER (owner postgres), como as demais pontes cs→public.
--
--   sugestao_valor_total: 15.000 para quem entrou pelo sinal (300 + 14.700);
--                         para compra cheia, a soma das compras cheias.
--   hotmart_bruto:        soma crua de compras.preco nas ofertas HM. É só
--                         REFERÊNCIA de tela, nunca a sugestão: em boleto
--                         parcelado (HOTMART_INSTALLMENTS) a Hotmart grava o
--                         valor da PARCELA, então essa soma subestima o pago.
-- Aditiva e idempotente.
-- =====================================================================

create or replace function cs.fn_hm_sugestao_financeira(p_comprador_id uuid)
returns table (sugestao_valor_total numeric, hotmart_bruto numeric)
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select
    case when ch.categoria_entrada = 'sinal' then 15000::numeric
         else (select coalesce(sum(c.preco), 0)
                 from public.compras c
                 join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
                where c.comprador_id = ch.comprador_id
                  and c.status in ('APPROVED','COMPLETE','COMPLETED')
                  and cat.categoria = 'compra_cheia')
    end as sugestao_valor_total,
    (select coalesce(sum(c.preco), 0)
       from public.compras c
       join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      where c.comprador_id = ch.comprador_id
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
        and cat.categoria in ('sinal','compra_cheia','diferenca')) as hotmart_bruto
  from cs.contatos_hm ch
  where ch.comprador_id = p_comprador_id;
$fn$;

grant execute on function cs.fn_hm_sugestao_financeira(uuid) to disparos_app;
