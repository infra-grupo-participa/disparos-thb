-- 0303_o_saldo_da_clinica_go_tem_valor_proprio
-- APLICADA EM PRODUCAO 18/08/2026.
--
-- As ofertas de saldo de reserva do AURUM estavam no catalogo SEM valor_tabela:
--   ulimhvmd (Clinica GO, R$ 13.000) e x72l7aq9 (Saldo reserva R$ 13.000).
-- Sem valor proprio nao ha como o sistema saber o contrato da pessoa.
-- As irmas ja tinham: fysepc10=43.000, vg96e2tc=43.000, z950cse4=21.500.
--
-- ⚠️ NAO mexe em o1sxigxl: o catalogo diz "Saldo HM R$ 12.772,68" e
-- fn_hm_produto_da_oferta a resolve como HM, nao AURUM.

update public.hm_product_catalog
   set valor_tabela = 13000.00,
       nome_comercial = coalesce(nome_comercial, 'Saldo de reserva Aurum — Clínica GO'),
       papel = coalesce(papel, 'saldo'),
       atualizado_em = now(), atualizado_por = '0303'
 where offer_code = 'ulimhvmd' and valor_tabela is null;

update public.hm_product_catalog
   set valor_tabela = 13000.00,
       nome_comercial = coalesce(nome_comercial, 'Saldo de reserva Aurum — R$ 13.000'),
       papel = coalesce(papel, 'saldo'),
       atualizado_em = now(), atualizado_por = '0303'
 where offer_code = 'x72l7aq9' and valor_tabela is null;

do $$
declare v_sem_valor int; v_ulim numeric; v_x72 numeric;
begin
  select valor_tabela into v_ulim from public.hm_product_catalog where offer_code='ulimhvmd';
  select valor_tabela into v_x72  from public.hm_product_catalog where offer_code='x72l7aq9';
  if v_ulim is distinct from 13000.00 or v_x72 is distinct from 13000.00 then
    raise exception '0303: valor_tabela nao gravado (ulimhvmd=%, x72l7aq9=%).', v_ulim, v_x72;
  end if;
  select count(*) into v_sem_valor from public.hm_product_catalog
   where categoria='diferenca' and valor_tabela is null
     and cs.fn_hm_produto_da_oferta(offer_code, null)='AURUM';
  raise notice '0303: ulimhvmd e x72l7aq9 = R$ 13.000. Restam % oferta(s) de saldo AURUM sem valor.', v_sem_valor;
end $$;
