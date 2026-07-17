-- =====================================================================
-- 0098_hm_so_finaliza_com_saldo
--
-- O SINAL DE R$300 NÃO É PAGAMENTO REALIZADO (caso do Décio).
--
-- Regra do time: um card só vira "pagamento finalizado" — apto para ativação,
-- aluno na base, contando como pago — quando o SALDO está coberto. Sinal ou
-- pagamento parcial NUNCA finalizam sozinhos; ficam no comercial, com o saldo
-- em aberto no contas a receber.
--
-- O arrasto para a Ativação já respeitava isso (fn_hm_provisionar_derivado exige
-- uma compra de 'diferenca'/'compra_cheia'). O buraco era o botão "Registrar
-- pagamento", que chama fn_hm_provisionar_aluno DIRETO, sem guard — foi por ele
-- que o Décio (só sinal) virou aluno apto. E o apto_ativacao era carimbado sem
-- checar o saldo.
--
-- Esta função é o guard único, usado pelas duas telas (a ativação Next e o
-- sistema-grupo-participa leem o mesmo banco). "Pode finalizar" =
--   • existe pagamento real do saldo na Hotmart (diferenca/compra_cheia — cobre
--     o parcelado, cuja entrada é compra_cheia em installments), OU
--   • o valor pago registrado no card cobre o pacote (pagamento à vista por fora
--     da Hotmart, lançado à mão pelo comercial com o valor cheio).
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
    -- pagamento real do saldo na Hotmart (o mesmo critério do provisionamento por arrasto)
    exists (
      select 1
        from public.compras c
        join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
       where c.comprador_id = p_comprador_id
         and c.status in ('APPROVED','COMPLETE','COMPLETED')
         and cat.categoria in ('diferenca','compra_cheia')
    )
    -- OU o pagamento à vista registrado à mão cobre o pacote inteiro
    or coalesce((
      select ch.valor_total > 0 and coalesce(ch.valor_pago, 0) >= ch.valor_total
        from cs.contatos_hm ch where ch.comprador_id = p_comprador_id
    ), false);
$fn$;

grant execute on function cs.fn_hm_pode_finalizar(uuid) to disparos_app;

comment on function cs.fn_hm_pode_finalizar(uuid) is
  'O saldo está coberto? Só então o card pode virar pagamento finalizado (apto/aluno). Sinal ou parcial = false. Guard compartilhado entre a ativação Next e o sistema-grupo-participa.';
