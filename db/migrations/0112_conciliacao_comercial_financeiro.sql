-- =====================================================================
-- 0112_conciliacao_comercial_financeiro
--
-- O comercial relatou que os números não batem com o financeiro. A apuração
-- (20/07/2026) achou quatro coisas distintas — três com correção mecânica
-- segura (aqui) e uma que é decisão comercial (fora daqui, ver nota no fim).
--
-- 1. vw_hm_pagamentos_orfaos acusava 21 pagamentos "perdidos" (R$ 191.237,44).
--    Todos eram PRÉ-CUTOFF (25/06/2026): turma anterior, corretamente fora da
--    esteira. A view não aplicava o cutoff que fn_seed_contato_hm aplica — logo
--    acusava como buraco exatamente o que o desenho manda ignorar. Alarme falso.
--
-- 2. O cache cs.contatos_hm.valor_pago havia derivado do razão em 3 cards
--    (maior caso: R$ 2.552,28 a MENOS que cs.hm_pagamentos). O razão é a fonte
--    da verdade; o cache é derivado. Recalcula quem divergiu.
--
-- 3. Lead novo que pagou o pacote inteiro ficava sem quitado_em, porque
--    fn_hm_recalcular_financeiro só crava quitado_em quando valor_total não é
--    nulo — e fn_hm_tem_lastro devolvia false. Para LEAD NOVO não há pró-rata:
--    o pacote é R$ 15.000 por regra, então dá para cravar sem inventar nada.
--    (Caso real: Carita da Veiga Jardim — pagou 300 + 14.700 e o financeiro
--    continuava mostrando "oferta_enviada".)
--
-- Idempotente: pode rodar de novo sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Órfãos: respeitar o cutoff da esteira
-- ---------------------------------------------------------------------
-- Mesmo corte de fn_seed_contato_hm / cs.vw_pagamentos: compra aprovada antes
-- de 25/06/2026 é legado e não abre card — então não é órfã, é passado.
create or replace view cs.vw_hm_pagamentos_orfaos as
  select c.id as compra_id,
         c.comprador_id,
         cp.nome,
         cp.email,
         cat.categoria,
         c.oferta_codigo,
         c.preco,
         c.metodo_pagamento,
         coalesce(c.data_aprovacao, c.data_compra) as pago_em,
         c.hotmart_transaction
    from compras c
    join compradores cp on cp.id = c.comprador_id
    join hm_product_catalog cat on cat.offer_code = c.oferta_codigo::text
   where c.status::text = any (array['APPROVED','COMPLETE','COMPLETED'])
     and cat.categoria = any (array['sinal','diferenca','compra_cheia'])
     and coalesce(c.data_aprovacao, c.data_compra) >= '2026-06-25 00:00:00+00'::timestamptz
     and not exists (
           select 1 from cs.contatos_hm ch
            where ch.comprador_id = cs.fn_hm_dono_do_pagamento(c.comprador_id));

comment on view cs.vw_hm_pagamentos_orfaos is
  'Pagamento HM aprovado, PÓS-cutoff (25/06/2026), cujo dono (via alias) não tem card. '
  'Se voltar linha, é dinheiro que entrou e a esteira não viu. Pré-cutoff é legado, não órfão.';

-- ---------------------------------------------------------------------
-- 1.5 Quarentena: cards com dupla contagem do crédito pró-rata
-- ---------------------------------------------------------------------
-- Aluno da base cujo valor_total foi cravado ACIMA do pacote da régra — sinal de
-- que o crédito pró-rata foi ignorado ao cravar, enquanto o pagamento antigo
-- (que virou esse mesmo crédito) segue somado em valor_pago. O saldo dá zero por
-- coincidência aritmética, não por quitação.
--
-- Estes cards NÃO podem passar por fn_hm_recalcular_financeiro aqui: a função
-- gravaria quitado_em (valor_total > 0 e saldo = 0) e CONSOLIDARIA o erro,
-- transformando um falso-verde do board em quitação formal no financeiro.
create or replace view cs.vw_hm_credito_duplo as
  select f.comprador_id, f.nome, f.publico,
         f.pacote_cravado, f.pacote_regra, f.credito,
         f.pago, f.pago_no_ciclo,
         round(f.pacote_cravado - f.pacote_regra, 2) as excesso_cravado,
         greatest(f.pacote_regra - f.pago_no_ciclo, 0) as saldo_provavel
    from cs.vw_hm_financeiro f
   where f.credito_compra_em is not null
     and f.pacote_cravado is not null
     and f.pacote_regra is not null
     and f.pacote_cravado > f.pacote_regra + 1;

comment on view cs.vw_hm_credito_duplo is
  'Aluno da base com pacote cravado acima da régua: o crédito pró-rata foi ignorado ao cravar '
  'e o pagamento que virou crédito segue contado como pagamento. Saldo zerado é falso. '
  'saldo_provavel = o que a régua cobraria. Quanto cobrar é decisão do comercial.';

-- ---------------------------------------------------------------------
-- 2. Ressincronizar o cache do razão
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select ch.comprador_id
      from cs.contatos_hm ch
      left join (
        select comprador_id, coalesce(sum(valor), 0) as soma
          from cs.hm_pagamentos group by comprador_id
      ) raz on raz.comprador_id = ch.comprador_id
     where abs(coalesce(raz.soma, 0) - coalesce(ch.valor_pago, 0)) > 0.01
       and not exists (select 1 from cs.vw_hm_credito_duplo d
                        where d.comprador_id = ch.comprador_id)
  loop
    perform cs.fn_hm_recalcular_financeiro(r.comprador_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Lead novo que pagou o pacote: cravar o total e deixar a máquina quitar
-- ---------------------------------------------------------------------
-- Só LEAD NOVO. Aluno da base tem crédito pró-rata e o pacote depende dele —
-- cravar 15.000 lá criaria dívida fantasma (ou apagaria dívida real).
update cs.contatos_hm ch
   set valor_total = 15000
  from cs.vw_hm_financeiro f
 where f.comprador_id = ch.comprador_id
   and f.publico = 'lead_novo'
   and ch.valor_total is null
   and ch.cancelamento_efetivado_em is null
   and f.pago >= 15000 - 1;   -- tolerância de centavos (I-8)

-- o update acima dispara nada por si; recalcula para gravar quitado_em
do $$
declare r record;
begin
  for r in
    select ch.comprador_id
      from cs.contatos_hm ch
     where ch.valor_total is not null
       and ch.quitado_em is null
       and ch.cancelamento_efetivado_em is null
       and coalesce(ch.valor_pago, 0) >= ch.valor_total - 1
       and not exists (select 1 from cs.vw_hm_credito_duplo d
                        where d.comprador_id = ch.comprador_id)
  loop
    perform cs.fn_hm_recalcular_financeiro(r.comprador_id);
  end loop;
end $$;

-- =====================================================================
-- NÃO tratado aqui, de propósito — precisa de decisão comercial.
-- Consultar: select * from cs.vw_hm_credito_duplo;
--
-- Naiara Dias Fiuza Silvestre, Guilherme Henrique Canal da Rocha e Pedro
-- Henrique dos Santos Simoes são alunos da base com valor_total cravado em
-- R$ 15.000 IGNORANDO o crédito pró-rata, e com valor_pago contendo o
-- pagamento antigo que JÁ virou crédito. O mesmo dinheiro conta duas vezes
-- (uma abatendo o pacote, outra abatendo o saldo) e o resultado dá zero por
-- coincidência aritmética — o board pinta de verde.
--
-- Ex.: Naiara — pacote pela régua = 15.000 − 13.561,64 (crédito) = 1.438,36;
-- pagou 299,99 no ciclo; deveria dever ~1.138,37, e não 0 (hoje) nem 14.700
-- (que seria o resultado de "só trocar pago por pago_no_ciclo" — dívida
-- fantasma de 13,5k). Quanto cada um deve é decisão do comercial, não do SQL.
-- =====================================================================
