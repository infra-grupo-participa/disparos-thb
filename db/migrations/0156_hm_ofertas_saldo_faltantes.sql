-- 0156_hm_ofertas_saldo_faltantes.sql
-- Cadastra as 8 ofertas de saldo HM que estavam FORA do catálogo (planilha de ofertas
-- enviada pelo Marcio em 2026-07-30). Enquanto ficam fora, a Hotmart aprova o pagamento
-- do saldo mas cs.fn_seed_contato_hm() cai em `if v_cat is null then return new` e o card
-- NÃO move — obrigando lançamento manual. Casos concretos: Nelci (7nzol8wb, 13.402,67,
-- pago 28/07) e Vanessa Melo (r9wdsusx, 12.969,79, pago 30/07), ambas presas em
-- "Reunião Finalizada".
--
-- Cada oferta entra nas DUAS estruturas:
--   1) cs.hm_ofertas_saldo    -> valor NOMINAL que quita o saldo (à vista/recorrente) + link
--   2) public.hm_product_catalog -> categoria='diferenca' (é o que o trigger reconhece)
--
-- Valores conforme a planilha. Pares à vista/recorrente compartilham o mesmo valor nominal.

-- 1) cs.hm_ofertas_saldo (valor nominal + link Hotmart padrão L97981750T)
insert into cs.hm_ofertas_saldo (codigo, valor, recorrente, link, ativo) values
  ('7nzol8wb', 13402.67, false, 'https://pay.hotmart.com/L97981750T?off=7nzol8wb', true),
  ('qu1hz5xd', 13402.67, true,  'https://pay.hotmart.com/L97981750T?off=qu1hz5xd', true),
  ('r9wdsusx', 12969.79, false, 'https://pay.hotmart.com/L97981750T?off=r9wdsusx', true),
  ('xghljp43', 12969.79, true,  'https://pay.hotmart.com/L97981750T?off=xghljp43', true),
  ('8dgokcy4',  7072.60, false, 'https://pay.hotmart.com/L97981750T?off=8dgokcy4', true),
  ('c515e1ei',  7072.60, true,  'https://pay.hotmart.com/L97981750T?off=c515e1ei', true),
  ('dl54fceb', 10765.00, false, 'https://pay.hotmart.com/L97981750T?off=dl54fceb', true),
  ('ppbt91sk', 10765.00, true,  'https://pay.hotmart.com/L97981750T?off=ppbt91sk', true)
on conflict (codigo) do update
  set valor = excluded.valor,
      recorrente = excluded.recorrente,
      link = excluded.link,
      ativo = true;

-- 2) public.hm_product_catalog (categoria='diferenca' — habilita o trigger a mover o card)
insert into public.hm_product_catalog (offer_code, product_id, product_name, product_type, categoria, concede_trilha, notes) values
  ('7nzol8wb', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 13.402,67 — catalogado 30/07 (estava fora do catálogo, caso Nelci)'),
  ('qu1hz5xd', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 13.402,67 (recorrente) — catalogado 30/07'),
  ('r9wdsusx', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 12.969,79 — catalogado 30/07 (estava fora do catálogo, caso Vanessa Melo)'),
  ('xghljp43', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 12.969,79 (recorrente) — catalogado 30/07'),
  ('8dgokcy4', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 7.072,60 — catalogado 30/07 (estava fora do catálogo)'),
  ('c515e1ei', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 7.072,60 (recorrente) — catalogado 30/07'),
  ('dl54fceb', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 10.765,00 — catalogado 30/07 (estava fora do catálogo)'),
  ('ppbt91sk', '5064314', 'Holding Masters', 'hm', 'diferenca', true, 'Saldo HM R$ 10.765,00 (recorrente) — catalogado 30/07')
on conflict (offer_code) do update
  set categoria = 'diferenca',
      concede_trilha = true,
      product_id = coalesce(public.hm_product_catalog.product_id, excluded.product_id),
      product_name = coalesce(public.hm_product_catalog.product_name, excluded.product_name),
      product_type = coalesce(public.hm_product_catalog.product_type, excluded.product_type),
      notes = excluded.notes;
