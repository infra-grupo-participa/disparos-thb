-- =====================================================================
-- 0100_hm_parcelado_pode_prosseguir
--
-- PARCELADO TAMBÉM PROSSEGUE PARA A ATIVAÇÃO.
--
-- Refinamento da 0098 (o sinal não finaliza): quem **parcelou** — registrou a
-- compra parcelada ou já está pagando as parcelas — pode seguir para a Ativação
-- mesmo sem ter pago o valor cheio, porque assumiu o compromisso e vai pagando.
-- Isso NÃO reabre o buraco do sinal-só: sinal à vista sem plano continua barrado
-- (é o caso Décio). A diferença é o compromisso de parcelamento.
--
-- "Pode finalizar" passa a ser verdadeiro quando:
--   • existe pagamento real do saldo na Hotmart (diferenca/compra_cheia), OU
--   • parcelou na Hotmart (metodo HOTMART_INSTALLMENTS aprovado), OU
--   • já pagou ao menos uma parcela/mensalidade (cs.hm_pagamentos), OU
--   • o comercial registrou o pagamento como 'parcelado', OU
--   • o valor pago à mão cobre o pacote inteiro (à vista fechado).
--
-- O saldo do parcelado continua no contas a receber — o que ele deve, quanto e a
-- previsão de pagamento (o acordo do comercial) seguem mapeados; ativar não quita.
-- Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_pode_finalizar(p_comprador_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
  select
    -- pagamento real do saldo na Hotmart (à vista/diferença/compra cheia)
    exists (
      select 1
        from public.compras c
        join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
       where c.comprador_id = p_comprador_id
         and c.status in ('APPROVED','COMPLETE','COMPLETED')
         and cat.categoria in ('diferenca','compra_cheia')
    )
    -- parcelou na Hotmart: a compra é parcelada (installments)
    or exists (
      select 1 from public.compras c
       where c.comprador_id = p_comprador_id
         and c.status in ('APPROVED','COMPLETE','COMPLETED')
         and c.metodo_pagamento = 'HOTMART_INSTALLMENTS'
    )
    -- já está pagando as parcelas (mensalidade lançada no razão)
    or exists (
      select 1 from cs.hm_pagamentos p
       where p.comprador_id = p_comprador_id and p.categoria = 'mensalidade'
    )
    -- o comercial registrou o pagamento como parcelado
    or coalesce((
      select ch.pagamento_forma = 'parcelado'
             or (ch.valor_total > 0 and coalesce(ch.valor_pago, 0) >= ch.valor_total)
        from cs.contatos_hm ch where ch.comprador_id = p_comprador_id
    ), false);
$fn$;

comment on function cs.fn_hm_pode_finalizar(uuid) is
  'O card pode virar pagamento finalizado (apto/aluno)? Sim se o saldo foi pago (à vista/Hotmart) OU se parcelou (installments Hotmart, mensalidade lançada, ou forma parcelado). Sinal-só sem plano = false (caso Décio). Guard compartilhado com o sistema-grupo-participa.';
