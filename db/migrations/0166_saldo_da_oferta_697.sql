-- 0166_saldo_da_oferta_697.sql
-- "No HM tem pessoas que compraram com a nova oferta de 697 e, nessa oferta, o preço
--  é os 15 mil descontados dos 697" (Marcio, 10/08).
--
-- Regra: quem entra pela oferta `rlgjsrul` (R$ 697, live do HT de 09/08) tem
--   pacote  = R$ 15.000
--   saldo   = 15.000 − o que pagou na entrada  → R$ 14.303
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO (e o que já estava certo)
--
-- Dos 20 compradores da oferta, **15 já mostravam R$ 14.303** — caíam no ramo
-- `publico = 'lead_novo'` e a conta batia por coincidência feliz (pacote 15.000 menos
-- o pago no ciclo). Esses não precisavam de nada.
--
-- Os outros **5 são ALUNOS DA BASE** (Domingos T35, Noélia T36, Armando T17, Luigi
-- T16, Roseli T35). Para aluno da base a view manda descontar o **crédito pró-rata**
-- do acesso antigo — e esse crédito ninguém calculou (vem do analista). Resultado:
-- `situacao = 'incalculavel'`, `saldo_a_perseguir = NULL`, e o card não dizia quanto
-- cobrar.
--
-- DECISÃO DO MARCIO: para quem entrou pelos R$ 697 vale a MESMA conta do lead novo —
-- **os 697 já são a condição fechada**, não há pró-rata por cima. Os 5 passam a
-- mostrar R$ 14.303 como os demais.
--
-- ---------------------------------------------------------------------------
-- COMO FOI FEITO — pela OFERTA, não pela lista de pessoas
--
-- Poderia ter cravado `valor_total` nos 5 cards e acabou. Não fiz: seria um número
-- fossilizado em 5 linhas, e a **próxima venda** da mesma oferta cairia no mesmo buraco
-- (a oferta segue ativa — uma venda entrou na madrugada de 10/08 depois da live).
--
-- A view passa a reconhecer a ENTRADA COM DESCONTO EMBUTIDO: se a pessoa tem pagamento
-- da `rlgjsrul`, o pacote é 15.000 e o saldo é 15.000 − essa entrada, seja ela lead
-- novo ou aluno da base. Venda futura já nasce certa, sem intervenção.
--
-- ⚠️ Alcance verificado: só 20 pessoas pagaram essa oferta, então o novo ramo não
-- toca nenhum dos outros 245 cards do financeiro. Os 30 cards que seguem
-- `incalculavel` são de outras campanhas e continuam esperando o crédito do analista
-- (ver [[0165]]: o card deles diz "saldo a definir", não o cheio).
--
-- Idempotente (create or replace view).

-- Os pontos que mudam em relação à 0163 estão marcados com "0166" no corpo abaixo.

create or replace view cs.vw_hm_financeiro as
 WITH base AS (
   SELECT ch.id AS contato_hm_id, ch.comprador_id, cp.nome, cp.email, ch.turma, ch.turma_origem,
     ch.estagio_id, ch.valor_total, COALESCE(ch.valor_pago, 0::numeric) AS pago, ch.quitado_em,
     ch.oferta_saldo_codigo, ch.link_saldo_enviado_em, ch.cancelamento_efetivado_em,
     ch.acesso_preexistente, ch.credito_valor_pago, ch.credito_compra_em, ch.produto,
     CASE WHEN 'Aluno THB'::text = ANY (ch.tags) THEN 'aluno_base'::text
          WHEN 'Aluno Aurum'::text = ANY (ch.tags) THEN 'aluno_base'::text
          WHEN 'Lead novo'::text = ANY (ch.tags) THEN 'lead_novo'::text
          ELSE 'nao_classificado'::text END AS publico,
     -- 0166: ENTRADA COM DESCONTO EMBUTIDO. A oferta ja e a condicao fechada.
     (select coalesce(sum(p2.valor),0) from cs.hm_pagamentos p2
       where p2.comprador_id = ch.comprador_id and p2.oferta_codigo = 'rlgjsrul') as entrada_697,
     (SELECT pr.credito FROM cs.fn_hm_prorata(ch.comprador_id)
        pr(dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar)) AS credito_hoje,
     (SELECT COALESCE(sum(p.valor),0) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
         AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)) AS pago_no_ciclo,
     (SELECT max(p.pago_em) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS ultimo_pagamento_em,
     ((SELECT count(*) FROM cs.hm_pagamentos p
        WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'
          AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)))::integer AS parcelas_pagas,
     ((SELECT max(c.parcelas) FROM compras c
        WHERE c.comprador_id = ch.comprador_id
          AND (c.status::text = ANY (ARRAY['APPROVED','COMPLETE','COMPLETED']))
          AND c.metodo_pagamento::text = 'HOTMART_INSTALLMENTS'))::integer AS parcelas_contratadas,
     (SELECT max(p.valor) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS valor_parcela
   FROM cs.contatos_hm ch JOIN compradores cp ON cp.id = ch.comprador_id
 ), regra AS (
   SELECT b.*,
     -- 0166: entrada com desconto embutido nao acumula pro-rata por cima.
     CASE WHEN b.entrada_697 > 0 THEN 0::numeric
          WHEN b.publico = 'lead_novo' THEN 0::numeric ELSE b.credito_hoje END AS credito,
     CASE WHEN b.produto = 'AURUM'
            THEN (select valor from cs.aurum_parametros where chave='pacote_cheio')
          WHEN b.entrada_697 > 0 THEN 15000::numeric                       -- 0166
          WHEN b.publico = 'lead_novo' THEN 15000::numeric
          WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
          ELSE NULL::numeric END AS pacote_regra,
     CASE WHEN b.produto = 'AURUM'
            THEN ((select valor from cs.aurum_parametros where chave='pacote_cheio')
                - (select valor from cs.aurum_parametros where chave='entrada'))
          WHEN b.entrada_697 > 0 THEN round(15000::numeric - b.entrada_697, 2)  -- 0166
          WHEN b.publico = 'lead_novo' THEN 14700::numeric
          WHEN b.credito_hoje IS NOT NULL THEN round(14700::numeric - b.credito_hoje, 2)
          ELSE NULL::numeric END AS saldo_regra
   FROM base b
 )
 SELECT r.contato_hm_id, r.comprador_id, r.nome, r.email, r.turma, r.turma_origem, r.estagio_id,
   r.publico, r.credito_valor_pago, r.credito_compra_em, r.credito, r.pacote_regra, r.saldo_regra,
   r.valor_total AS pacote_cravado, r.pago,
   CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0) END AS saldo_cravado,
   COALESCE(CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0) END,
            CASE WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0) END) AS saldo_a_perseguir,
   CASE WHEN r.valor_total IS NOT NULL AND r.pacote_regra IS NOT NULL
        THEN round(r.valor_total - r.pacote_regra, 2) END AS divergencia_regra,
   r.quitado_em IS NOT NULL AS quitado, r.cancelamento_efetivado_em IS NOT NULL AS cancelado,
   r.oferta_saldo_codigo, r.link_saldo_enviado_em IS NOT NULL AS oferta_enviada,
   CASE WHEN r.cancelamento_efetivado_em IS NOT NULL THEN 'cancelado'
        WHEN r.quitado_em IS NOT NULL THEN 'quitado'
        WHEN (EXISTS (SELECT 1 FROM cs.hm_pagamentos p
                       WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'
                         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto))) THEN 'mensalidade_em_curso'
        -- 0166: entrada de 697 tira o card do limbo "incalculavel"
        WHEN r.publico = 'aluno_base' AND r.credito_hoje IS NULL AND r.entrada_697 = 0 THEN 'incalculavel'
        WHEN r.link_saldo_enviado_em IS NOT NULL THEN 'oferta_enviada'
        ELSE 'saldo_parado' END AS situacao,
   r.pago_no_ciclo, r.ultimo_pagamento_em, r.parcelas_pagas, r.parcelas_contratadas, r.valor_parcela,
   CASE WHEN COALESCE(r.valor_total, r.pacote_regra) > 0
        THEN round(100 * r.pago / COALESCE(r.valor_total, r.pacote_regra), 1) END AS pago_pct,
   ab.pago_em AS ultimo_abatimento_em, ab.valor AS ultimo_abatimento_valor,
   ab.categoria AS ultimo_abatimento_categoria
 FROM regra r
 LEFT JOIN LATERAL (SELECT p.pago_em, p.valor, p.categoria FROM cs.hm_pagamentos p
    WHERE p.comprador_id = r.comprador_id
      AND (p.categoria = ANY (ARRAY['mensalidade','saldo','compra_cheia']))
      AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
    ORDER BY p.pago_em DESC LIMIT 1) ab ON true;

grant select on cs.vw_hm_financeiro to disparos_app;
