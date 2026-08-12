-- 0198_board_aurum_le_so_a_fonte_do_aurum.sql
-- No ramo AURUM, `saldo_a_perseguir` deixa de aceitar "pacote cravado" no card.
--
-- A 0195 tinha deixado `COALESCE(saldo_cravado, aurum_saldo)` por simetria com o HM.
-- O teste de venda revertida mostrou o preço disso: bastou um caminho legado escrever
-- `valor_total` no card do AURUM (era `fn_hm_provisionar_aluno`, corrigida na 0197)
-- para o board voltar a mentir — mostrou 2.072,68 onde a ficha dizia 35.927,32.
--
-- O saldo do AURUM tem fonte única: `cs.fn_aurum_saldo` (planilha − pagamentos). Ponto.
-- Assim nenhum campo escrito por engano em `cs.contatos_hm` consegue mudar o número que
-- a operação usa para cobrar.
--
-- Resto da view idêntico à 0195. Só a linha do ramo AURUM muda.
create or replace view cs.vw_hm_financeiro as
 WITH base AS (
         SELECT ch.id AS contato_hm_id, ch.comprador_id, cp.nome, cp.email, ch.turma,
            ch.turma_origem, ch.estagio_id, ch.valor_total,
            COALESCE(ch.valor_pago, 0::numeric) AS pago,
            ch.quitado_em, ch.oferta_saldo_codigo, ch.link_saldo_enviado_em,
            ch.cancelamento_efetivado_em, ch.acesso_preexistente, ch.credito_valor_pago,
            ch.credito_compra_em, ch.produto,
                CASE
                    WHEN 'Aluno THB'::text = ANY (ch.tags) THEN 'aluno_base'::text
                    WHEN 'Aluno Aurum'::text = ANY (ch.tags) THEN 'aluno_base'::text
                    WHEN 'Lead novo'::text = ANY (ch.tags) THEN 'lead_novo'::text
                    ELSE 'nao_classificado'::text
                END AS publico,
            ent.oferta_codigo AS entrada_oferta, ent.pacote_cheio AS entrada_pacote,
            ent.valor AS entrada_valor, ent.pago_em AS entrada_pago_em,
            COALESCE(ent.condicao_fechada, false) AS entrada_fechada,
            COALESCE(( SELECT sum(p3.valor) FROM cs.hm_pagamentos p3
                  WHERE p3.comprador_id = ch.comprador_id AND p3.oferta_codigo = ent.oferta_codigo), 0::numeric) AS entrada_pago,
            ( SELECT pr.credito FROM cs.fn_hm_prorata(ch.comprador_id) pr(dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar)) AS credito_hoje,
            CASE WHEN ch.produto = 'AURUM'::text THEN cs.fn_aurum_saldo(ch.comprador_id) ELSE NULL::numeric END AS aurum_saldo,
            ( SELECT COALESCE(sum(p.valor), 0::numeric) FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto) AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em) AND NOT (ent.pago_em IS NOT NULL AND p.pago_em < ent.pago_em AND p.categoria = 'sinal'::text AND p.oferta_codigo IS DISTINCT FROM ent.oferta_codigo)) AS pago_no_ciclo,
            ( SELECT max(p.pago_em) FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS ultimo_pagamento_em,
            (( SELECT count(*) FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)))::integer AS parcelas_pagas,
            (( SELECT max(c.parcelas) FROM compras c
                  WHERE c.comprador_id = ch.comprador_id AND (c.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text, 'COMPLETED'::text])) AND c.metodo_pagamento::text = 'HOTMART_INSTALLMENTS'::text))::integer AS parcelas_contratadas,
            ( SELECT max(p.valor) FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS valor_parcela
           FROM cs.contatos_hm ch
             JOIN compradores cp ON cp.id = ch.comprador_id
             LEFT JOIN LATERAL ( SELECT p.oferta_codigo, cat.pacote_cheio, p.valor, p.pago_em,
                    cat.entrada_condicao_fechada AS condicao_fechada
                   FROM cs.hm_pagamentos p JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
                  WHERE p.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND cat.pacote_cheio IS NOT NULL AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto) AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)
                  ORDER BY p.pago_em DESC, p.valor DESC, p.id DESC LIMIT 1) ent ON true
        ), regra AS (
         SELECT b.contato_hm_id, b.comprador_id, b.nome, b.email, b.turma, b.turma_origem,
            b.estagio_id, b.valor_total, b.pago, b.quitado_em, b.oferta_saldo_codigo,
            b.link_saldo_enviado_em, b.cancelamento_efetivado_em, b.acesso_preexistente,
            b.credito_valor_pago, b.credito_compra_em, b.produto, b.publico,
            b.entrada_oferta, b.entrada_pacote, b.entrada_valor, b.entrada_pago_em,
            b.entrada_fechada, b.entrada_pago, b.credito_hoje, b.aurum_saldo,
            b.pago_no_ciclo, b.ultimo_pagamento_em, b.parcelas_pagas,
            b.parcelas_contratadas, b.valor_parcela,
                CASE WHEN b.publico = 'lead_novo'::text THEN 0::numeric ELSE b.credito_hoje END AS credito,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN ( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros WHERE aurum_parametros.chave = 'pacote_cheio'::text)
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote -
                    CASE WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                         ELSE COALESCE(b.credito_hoje, 0::numeric) END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 15000::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS pacote_regra,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN b.aurum_saldo
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote - b.entrada_pago -
                    CASE WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                         ELSE COALESCE(b.credito_hoje, 0::numeric) END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 14700::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(14700::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS saldo_regra
           FROM base b
        )
 SELECT r.contato_hm_id, r.comprador_id, r.nome, r.email, r.turma, r.turma_origem,
    r.estagio_id, r.publico, r.credito_valor_pago, r.credito_compra_em, r.credito,
    r.pacote_regra, r.saldo_regra, r.valor_total AS pacote_cravado, r.pago,
        CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
             ELSE NULL::numeric END AS saldo_cravado,
        -- [0198] AURUM: fonte única, sem atalho por pacote cravado.
        CASE
            WHEN r.produto = 'AURUM'::text THEN r.aurum_saldo
            ELSE COALESCE(
                CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
                     ELSE NULL::numeric END,
                CASE WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0::numeric)
                     ELSE NULL::numeric END)
        END AS saldo_a_perseguir,
        CASE WHEN r.valor_total IS NOT NULL AND r.pacote_regra IS NOT NULL
             THEN round(r.valor_total - r.pacote_regra, 2) ELSE NULL::numeric END AS divergencia_regra,
    r.quitado_em IS NOT NULL AS quitado,
    r.cancelamento_efetivado_em IS NOT NULL AS cancelado,
    r.oferta_saldo_codigo,
    r.link_saldo_enviado_em IS NOT NULL AS oferta_enviada,
        CASE
            WHEN r.cancelamento_efetivado_em IS NOT NULL THEN 'cancelado'::text
            WHEN r.quitado_em IS NOT NULL THEN 'quitado'::text
            WHEN (EXISTS ( SELECT 1 FROM cs.hm_pagamentos p
              WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto))) THEN 'mensalidade_em_curso'::text
            WHEN r.publico = 'aluno_base'::text AND r.credito_hoje IS NULL AND NOT r.entrada_fechada THEN 'incalculavel'::text
            WHEN r.link_saldo_enviado_em IS NOT NULL THEN 'oferta_enviada'::text
            ELSE 'saldo_parado'::text
        END AS situacao,
    r.pago_no_ciclo, r.ultimo_pagamento_em, r.parcelas_pagas, r.parcelas_contratadas,
    r.valor_parcela,
        CASE WHEN COALESCE(r.valor_total, r.pacote_regra) > 0::numeric
             THEN round(100::numeric * r.pago / COALESCE(r.valor_total, r.pacote_regra), 1)
             ELSE NULL::numeric END AS pago_pct,
    ab.pago_em AS ultimo_abatimento_em, ab.valor AS ultimo_abatimento_valor,
    ab.categoria AS ultimo_abatimento_categoria,
    r.entrada_oferta, r.entrada_valor, r.entrada_pago_em
   FROM regra r
     LEFT JOIN LATERAL ( SELECT p.pago_em, p.valor, p.categoria FROM cs.hm_pagamentos p
          WHERE p.comprador_id = r.comprador_id AND (p.categoria = ANY (ARRAY['mensalidade'::text, 'saldo'::text, 'compra_cheia'::text])) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
          ORDER BY p.pago_em DESC LIMIT 1) ab ON true;

revoke insert, update, delete on cs.vw_hm_financeiro from disparos_app;
grant select on cs.vw_hm_financeiro to disparos_app;
