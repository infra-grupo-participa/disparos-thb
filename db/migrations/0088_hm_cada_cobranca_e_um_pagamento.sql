-- =====================================================================
-- 0088_hm_cada_cobranca_e_um_pagamento
--
-- O ERRO QUE ESTA MIGRATION CONSERTA — a 2ª parcela continuava sumindo.
--
-- Eu supus que cada parcela do Parcelado Hotmart chegava como uma TRANSAÇÃO NOVA.
-- Está errado: a Hotmart REUSA a mesma transação e incrementa um contador de
-- cobranças. O export oficial prova:
--   HP2659675855 · Marina Ribeiro Lima  · cobrança 2 de 12
--   HP3646635049 · Neide de Vasconcelos · cobrança 3 de 12
--   HP1646441009 · Luana N. T. de Souza · cobrança 3 de 10
--
-- Consequência: `persistPurchase` faz upsert por hotmart_transaction (sobrescreve a
-- linha em vez de criar outra) e o razão tinha índice único por transação — então a
-- 2ª cobrança não virava lançamento nenhum. A Marina pagou DUAS parcelas
-- (R$ 2.552,28) e o sistema contava uma, cobrando R$ 1.276,14 a mais dela.
--
-- A chave do razão passa a ser (transação, número da cobrança). Cada cobrança é um
-- pagamento — porque é o que ela é.
--
-- Aditiva e idempotente. Aplicada em 14/07/2026.
-- =====================================================================

alter table public.compras add column if not exists numero_cobranca     smallint;
alter table public.compras add column if not exists tipo_cobranca       text;
alter table public.compras add column if not exists valor_com_impostos  numeric(12,2);
alter table public.compras add column if not exists valor_liquido       numeric(12,2);
alter table public.compras add column if not exists taxa_processamento  numeric(12,2);
alter table public.compras add column if not exists taxa_parcelamento   numeric(12,2);
alter table public.compras add column if not exists canal_venda         text;
alter table public.compras add column if not exists codigo_assinante    text;
alter table public.compras add column if not exists data_vencimento     date;

comment on column public.compras.numero_cobranca is
  'Qual cobrança desta transação já caiu (Parcelado Hotmart reusa a transação e incrementa). 3 = três parcelas pagas.';
comment on column public.compras.preco is
  'Valor SEM impostos. No Parcelado Hotmart é o valor da PARCELA, não do contrato.';
comment on column public.compras.valor_com_impostos is
  'O que o cliente desembolsou nesta cobrança (inclui juros de parcelamento).';
comment on column public.compras.valor_liquido is
  'O que o produtor recebeu, já descontadas as taxas da Hotmart.';

update cs.hm_pagamentos set parcela = 1
 where origem = 'hotmart' and parcela is null;

drop index if exists cs.hm_pagamentos_transacao_uk;
create unique index if not exists hm_pagamentos_cobranca_uk
  on cs.hm_pagamentos (transacao, coalesce(parcela, 1)) where transacao is not null;

create or replace function cs.fn_hm_lancar_compra(p_compra_id uuid)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_c public.compras%rowtype; v_dono uuid; v_cat text; v_recor boolean;
  v_natureza text; v_cobrancas smallint; v_id uuid; v_ultimo uuid;
  i smallint; v_quando timestamptz;
begin
  select * into v_c from public.compras where id = p_compra_id;
  if not found or v_c.status not in ('APPROVED','COMPLETE','COMPLETED') then return null; end if;

  v_dono := cs.fn_hm_dono_do_pagamento(v_c.comprador_id);
  if not exists (select 1 from cs.contatos_hm where comprador_id = v_dono) then return null; end if;

  select cat.categoria into v_cat from public.hm_product_catalog cat
   where cat.offer_code = v_c.oferta_codigo limit 1;
  select os.recorrente into v_recor from cs.hm_ofertas_saldo os
   where os.codigo = v_c.oferta_codigo limit 1;
  if v_cat is null or v_cat not in ('sinal','diferenca','compra_cheia') then return null; end if;

  v_natureza := cs.fn_hm_natureza_pagamento(v_cat, v_c.metodo_pagamento, v_recor);
  if v_natureza is null or coalesce(v_c.preco, 0) = 0 then return null; end if;

  -- Quantas cobranças desta transação já caíram. Sem o dado, vale 1 (à vista).
  v_cobrancas := greatest(coalesce(v_c.numero_cobranca, 1), 1);
  v_quando := coalesce(v_c.data_aprovacao, v_c.data_compra, now());

  -- Uma linha por cobrança. A data da última é a da aprovação; as anteriores são
  -- estimadas para trás, um mês por parcela — a Hotmart não reenvia a data de cada
  -- cobrança antiga, e uma data aproximada é melhor que um pagamento invisível.
  for i in 1..v_cobrancas loop
    insert into cs.hm_pagamentos (comprador_id, categoria, valor, pago_em, origem, transacao,
                                  compra_id, oferta_codigo, metodo_pagamento, parcela, obs, autor)
    values (
      v_dono, v_natureza, v_c.preco,
      case when i = v_cobrancas then v_quando
           else v_quando - ((v_cobrancas - i) || ' months')::interval end,
      'hotmart', v_c.hotmart_transaction, v_c.id, v_c.oferta_codigo, v_c.metodo_pagamento, i,
      case when v_dono <> v_c.comprador_id
                then 'Pago no cadastro duplicado da Hotmart (' || v_c.comprador_id || ')' end
        || case when i < v_cobrancas then ' · data estimada (a Hotmart não reenvia a data das cobranças anteriores)' else '' end,
      'hotmart'
    )
    on conflict (transacao, coalesce(parcela, 1)) where transacao is not null do nothing
    returning id into v_id;
    if v_id is not null then v_ultimo := v_id; end if;
  end loop;

  return v_ultimo;
end$fn$;

grant execute on function cs.fn_hm_lancar_compra(uuid) to disparos_app;
