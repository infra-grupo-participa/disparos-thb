-- 0159_hm_ofertas_orfas_quelen_scarlett.sql
-- Fecha os 2 casos REAIS achados na auditoria de 10/08: pagamentos de HM que a
-- operação não enxergava porque a oferta estava fora do `public.hm_product_catalog`
-- (mesmo furo da 0157, ver [[2026-08-10 - Oferta fora do catalogo some da operacao em silencio]]).
--
-- ⚠️ A auditoria original apontou 5 casos; 3 eram FALSO-POSITIVO da minha query, que
-- não considerava `cs.hm_comprador_alias` nem o cutoff da campanha:
--   · Carita da Veiga Jardim — alias já existe desde 17/07; está QUITADA (15.000).
--   · Renato Nicolodi        — alias já existe desde 14/07; mensalidade em curso.
--   · Luana N T. de Souza    — compra original de ABRIL (antes do cutoff 25/06); as de
--     jun/jul são parcelas do boleto, corretamente ignoradas pela guarda de parcela.
-- Nenhum dos três precisa de correção. Query de auditoria corrigida na nota do vault.
--
-- ---------------------------------------------------------------------------
-- CASO 1 — Quelen Soper (decisão do Marcio, 10/08): as duas ofertas são SALDO.
--
--   sinal  z391kxd9   R$   300,00  (26/07, já no razão)
--   saldo  6lcg6d5q   R$ 4.700,00  (28/07, PIX à vista)
--   saldo  f36zo585   R$ 2.075,24 x5 (28/07, HOTMART_INSTALLMENTS)  ← recorrente
--   -------------------------------------------------------------
--   contratado R$ 15.376,20 · pago até agora R$ 6.775,24 · faltam 4 parcelas
--
-- Hoje o card dela diz `saldo_parado` devendo R$ 14.700 — ou seja, o board pode
-- mandar cobrar R$ 14.700 de quem já pagou R$ 6.775,24. É a variante PIOR do furo:
-- ela TEM card, então o sintoma não é sumiço, é VALOR ERRADO na cara do operador.
--
-- CASO 2 — Scarlett Zeilinger (decisão do Marcio): compra cheia parcelada.
--   a77262a0  R$ 1.350,53 x12 = R$ 16.206,36 (28/07) — entrou direto no programa,
--   SEM sinal de R$300. Sem card e sem lançamento desde 28/07 (13 dias invisível).
--
-- `cs.fn_hm_natureza_pagamento` já resolve a natureza sozinha: método
-- HOTMART_INSTALLMENTS (ou recorrente=true) vira 'mensalidade' — então as duas
-- parceladas entram como mensalidade em curso, sem precisar de regra nova.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Catálogo
-- ---------------------------------------------------------------------------
insert into public.hm_product_catalog
  (product_id, offer_code, product_name, product_type, notes, categoria, concede_trilha)
values
  ('5064314','6lcg6d5q','Holding Masters','hm',
   'Saldo HM R$ 4.700,00 (à vista) — catalogado 10/08 (estava fora do catálogo, caso Quelen)',
   'diferenca', true),
  ('5064314','f36zo585','Holding Masters','hm',
   'Saldo HM R$ 2.075,24 em 5x (recorrente) — catalogado 10/08 (caso Quelen)',
   'diferenca', true),
  ('5064314','a77262a0','Holding Masters','hm',
   'Compra cheia parcelada 12x R$ 1.350,53 (sem sinal) — catalogado 10/08 (caso Scarlett)',
   'compra_cheia', true)
on conflict (offer_code) do update
  set categoria      = excluded.categoria,
      notes          = excluded.notes,
      product_id     = excluded.product_id,
      product_name   = excluded.product_name,
      product_type   = excluded.product_type,
      concede_trilha = excluded.concede_trilha;

-- ---------------------------------------------------------------------------
-- 2) Ofertas de saldo (só as da Quelen) — valor NOMINAL + flag de recorrência.
-- Sem isto `cs.fn_hm_valores_derivados` não sabe o valor do pacote dela, e a
-- `recorrente` é o que faz a f36zo585 ser lida como mensalidade ([[hm-ofertas-saldo]]).
-- ---------------------------------------------------------------------------
insert into cs.hm_ofertas_saldo (codigo, valor, recorrente, link, ativo) values
  ('6lcg6d5q', 4700.00, false, 'https://pay.hotmart.com/L97981750T?off=6lcg6d5q', true),
  ('f36zo585', 2075.24, true,  'https://pay.hotmart.com/L97981750T?off=f36zo585', true)
on conflict (codigo) do update
  set valor = excluded.valor, recorrente = excluded.recorrente,
      link = excluded.link, ativo = true;

-- ---------------------------------------------------------------------------
-- 3) Backfill do card da Scarlett (a Quelen já tem card; só falta o dinheiro).
-- Mesma técnica da 0157: forçar a TRANSIÇÃO de status, porque
-- `trg_seed_contato_hm_upd` só dispara em não-aprovado -> aprovado e estas compras
-- já nasceram APPROVED. 'PENDING' é a ponte neutra (não aprovado, não cancelado).
-- ---------------------------------------------------------------------------
do $$
declare r record; n integer := 0;
begin
  for r in
    select c.id, c.status from public.compras c
     where c.oferta_codigo in ('6lcg6d5q','f36zo585','a77262a0')
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and not exists (
         select 1 from cs.contatos_hm ch
          where ch.comprador_id = coalesce(
            (select a.canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
            c.comprador_id))
     order by c.data_compra
  loop
    update public.compras set status = 'PENDING' where id = r.id;
    update public.compras set status = r.status  where id = r.id;
    n := n + 1;
  end loop;
  raise notice '0159: % compra(s) reprocessada(s) para criar card', n;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Razão — lança os pagamentos que estavam evaporando.
-- Roda DEPOIS do backfill: `cs.fn_hm_lancar_compra` exige que o card já exista.
-- Idempotente pela unique (transacao, parcela).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.id from public.compras c
     where c.oferta_codigo in ('6lcg6d5q','f36zo585','a77262a0')
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
     order by c.data_compra
  loop
    perform cs.fn_hm_lancar_compra(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4b) Saldo manual da Quelen — o caso que o cálculo automático NÃO cobre.
--
-- ⚠️ Descoberto no ensaio (transação revertida) ANTES de aplicar: só com o catálogo,
-- a Quelen sairia como **QUITADA com pacote de R$ 2.375,24** — pior que o erro
-- original, porque pararia de cobrar as 4 parcelas que ela ainda deve.
--
-- Por quê: `cs.fn_hm_valores_derivados` faz `total = 300 + valor_nominal_da_oferta_de
-- _saldo`, e pega UMA oferta só (`order by data desc limit 1`). O modelo pressupõe um
-- único link de saldo por aluno — a Quelen pagou o saldo em DUAS ofertas (4.700 à
-- vista + 5x 2.075,24), caso que a regra não prevê. Ela leu só a f36zo585 (2.075,24)
-- como o saldo inteiro.
--
-- NÃO alteramos a função: ela serve 200+ cards e mudar a regra do pacote por um caso
-- é risco desproporcional (e o pró-rata de quem tem oferta única quebraria). Usamos o
-- mecanismo que já existe para exatamente isso — `saldo_a_pagar_manual` (0151), o
-- valor que vem do Victor e vence o cálculo.
--
--   contratado  300 + 4.700 + (2.075,24 x 5) = R$ 15.376,20
--   pago        300 + 4.700 + 2.075,24       = R$  6.775,24  (1ª parcela)
--   a pagar     2.075,24 x 4                 = R$  8.600,96
-- ---------------------------------------------------------------------------
update cs.contatos_hm ch
   set saldo_a_pagar_manual     = 8600.96,
       saldo_a_pagar_manual_por = 'migration 0159 (auditoria 10/08)',
       saldo_a_pagar_manual_em  = now(),
       atualizado_em            = now()
  from public.compradores co
 where co.id = ch.comprador_id
   and co.email = 'quelensoper@yahoo.com.br'
   and ch.saldo_a_pagar_manual is null;   -- não sobrescreve valor que o Victor já informou

insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select ch.id, 'nota',
       'Saldo a pagar fixado em R$ 8.600,96 (4 parcelas de R$ 2.075,24). Contratou R$ 15.376,20 '
       '(sinal 300 + entrada 4.700 + 5x 2.075,24) e já pagou R$ 6.775,24. O cálculo automático '
       'não cobre saldo pago em DUAS ofertas e a daria como quitada — conferir com o Victor.',
       'sistema'
  from cs.contatos_hm ch join public.compradores co on co.id = ch.comprador_id
 where co.email = 'quelensoper@yahoo.com.br'
   and not exists (
     select 1 from cs.interacoes i
      where i.contato_hm_id = ch.id and i.descricao like 'Saldo a pagar fixado em R$ 8.600,96%');

-- ---------------------------------------------------------------------------
-- 5) Timeline — deixa registrado que o pagamento é ANTIGO e o card/lançamento é de
-- hoje. Sem isso, uma auditoria futura leria 13 dias de silêncio como desleixo do
-- comercial, quando a causa foi a oferta fora do catálogo.
-- ---------------------------------------------------------------------------
insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select distinct ch.id, 'sistema',
       'Pagamento de 28/07 reconhecido só agora (0159): a oferta ' || c.oferta_codigo ||
       ' estava fora do catálogo, então o webhook gravou a compra mas o valor não entrava no razão',
       'sistema'
  from public.compras c
  join cs.contatos_hm ch on ch.comprador_id = coalesce(
        (select a.canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
        c.comprador_id)
 where c.oferta_codigo in ('6lcg6d5q','f36zo585','a77262a0')
   and c.status in ('APPROVED','COMPLETE','COMPLETED')
   and not exists (
     select 1 from cs.interacoes i
      where i.contato_hm_id = ch.id
        and i.descricao like 'Pagamento de 28/07 reconhecido só agora (0159)%');
