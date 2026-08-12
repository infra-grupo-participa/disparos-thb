-- =====================================================================
-- 0214_status_parcela_reconciliado
--
-- O BUG MEDIDO NO BANCO (12/08/2026) — "Parcela atrasada" mentindo para quem PAGOU.
--
-- `cs.contatos_hm.pagamento_previsto_em` é a data da PRÓXIMA parcela combinada,
-- digitada manualmente pelo comercial. O board pinta "Parcela atrasada"
-- (app/hm/kanban/page.tsx:190-199, `parcelaStatus`) só olhando se essa data já
-- passou — NADA reconcilia com o que realmente caiu em cs.hm_pagamentos.
--
-- Medição original (sem filtro por produto): 47 cards com pagamento_previsto_em
-- vencida. Destes, 22 (47%) JÁ TÊM um pagamento em cs.hm_pagamentos POSTERIOR à
-- data prevista — o aluno pagou, e o card segue gritando atraso porque ninguém
-- apagou/atualizou o campo manual. Só 25 seriam atraso real (venceu e não caiu
-- nada depois). Números re-medidos após o filtro por produto abaixo — ver bloco
-- de verificação no fim do arquivo.
--
-- A CORREÇÃO É NA LEITURA, NÃO NO DADO. `pagamento_previsto_em` continua vivo —
-- é acordo comercial digitado por gente (data prometida, não um cronograma
-- gerado). O que muda é o CÁLCULO: "atrasado" só quando a data venceu E ninguém
-- pagou nada depois dela. Confrontar contra a RAZÃO (cs.hm_pagamentos, fato),
-- nunca contra a digitação isolada.
--
-- ⚠️ IMPORTANTE — de onde parte esta migration:
-- A 0084 (que introduziu parcelas/ultimo_pagamento_em) NÃO é mais a forma
-- vigente da view. Ela foi reescrita várias vezes desde então — sobretudo pela
-- 0198, que deu ao AURUM fonte única de saldo (cs.fn_aurum_saldo) e separou o
-- board por produto via cs.fn_hm_pagamento_do_produto em TODOS os agregados
-- (pago_no_ciclo, ultimo_pagamento_em, parcelas_pagas, valor_parcela), além de
-- ter acrescentado a entrada vigente (0179) e os abatimentos (0085/0198). A
-- fonte confiável é sempre `pg_get_viewdef('cs.vw_hm_financeiro')` no banco —
-- confirmado ali: 35 colunas vigentes antes desta migration. Esta migration
-- parte da 0198 (a única CREATE OR REPLACE completa depois da 0084), não da
-- 0084, para não perder AURUM/entrada/abatimentos no meio do caminho.
--
-- Onde corrigir: cs.vw_hm_financeiro já calcula `ultimo_pagamento_em` a partir
-- do razão. Dois campos novos aqui, `pagamento_previsto_em` e `status_parcela`,
-- lidos por QUALQUER consumidor (XLSX, tabela, e o board se quiser adotar
-- depois) sem duplicar a lógica em TypeScript. Zero N+1: tudo já é agregado por
-- comprador dentro da própria view.
--
-- status_parcela:
--   quitado     — já quitou o pacote (ch.quitado_em preenchido)
--   em_dia      — sem data prevista vencida, OU pagou (do MESMO produto) depois
--                 da data prevista
--   atrasado    — data prevista no passado E ninguém pagou (do mesmo produto)
--                 desde então
--   aguardando  — não tem data prevista combinada (nada a avaliar)
--
-- 🔴 EXIGÊNCIA DE CONSISTÊNCIA: o subselect de `pagamento_apos_previsao_em`
-- filtra por cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto), igual
-- a TODOS os outros agregados desta view (pago_no_ciclo, ultimo_pagamento_em,
-- parcelas_pagas, valor_parcela). Sem esse filtro, um pagamento do AURUM
-- "resgataria" uma parcela atrasada do HM (ou vice-versa) — falso negativo, o
-- inverso do bug que esta migration corrige. A pessoa pode ter card nos dois
-- produtos (0163/0164); o pagamento que reconcilia tem que ser do MESMO card.
--
-- ⚠️ Este campo NÃO substitui pagamento_previsto_em nem o card do kanban (fora
-- do escopo desta migration — pertence a outro agente). É a leitura correta
-- disponível para quem consumir a view financeira.
--
-- Colunas novas vão para o FIM do select — create-or-replace de view não deixa
-- inserir no meio nem remover as existentes. Aditiva e idempotente.
-- =====================================================================

create or replace view cs.vw_hm_financeiro as
 WITH base AS (
         SELECT ch.id AS contato_hm_id, ch.comprador_id, cp.nome, cp.email, ch.turma,
            ch.turma_origem, ch.estagio_id, ch.valor_total,
            COALESCE(ch.valor_pago, 0::numeric) AS pago,
            ch.quitado_em, ch.oferta_saldo_codigo, ch.link_saldo_enviado_em,
            ch.cancelamento_efetivado_em, ch.acesso_preexistente, ch.credito_valor_pago,
            ch.credito_compra_em, ch.produto,
            -- 0214: a data combinada com o comercial — insumo do status_parcela abaixo.
            ch.pagamento_previsto_em,
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
            -- 0214: existe pagamento CAÍDO NA data combinada ou DEPOIS, do MESMO
            -- produto deste card? É a reconciliação — se sim, a "parcela atrasada"
            -- do board estava mentindo (o aluno já pagou).
            --
            -- ⚠️ Filtro por produto (cs.fn_hm_pagamento_do_produto), igual a todo
            -- outro agregado desta view: sem ele, um pagamento do AURUM resgataria
            -- uma parcela atrasada do HM (a pessoa pode ter card nos dois — 0163/0164).
            --
            -- ⚠️ `>=`, não `>`: quem paga NO DIA do vencimento (boleto/pix na data, o
            -- caso mais comum de pagamento em dia) não tem pagamento estritamente
            -- POSTERIOR à previsão — com `>` viraria "atrasado" assim que a data
            -- passasse, reintroduzindo exatamente o falso positivo que esta
            -- migration existe para matar.
            --
            -- ⚠️ Fuso explícito: `pago_em` é timestamptz e o servidor roda em UTC —
            -- um pix às 21h de Brasília no dia do vencimento cai como D+1 se
            -- convertido sem `at time zone`, marcando como atrasado quem pagou na
            -- hora certa.
            ( SELECT max(p.pago_em) FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id
                    AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
                    AND ch.pagamento_previsto_em IS NOT NULL
                    AND (p.pago_em AT TIME ZONE 'America/Sao_Paulo')::date >= ch.pagamento_previsto_em
            ) AS pagamento_apos_previsao_em,
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
            b.credito_valor_pago, b.credito_compra_em, b.produto, b.pagamento_previsto_em, b.publico,
            b.entrada_oferta, b.entrada_pacote, b.entrada_valor, b.entrada_pago_em,
            b.entrada_fechada, b.entrada_pago, b.credito_hoje, b.aurum_saldo,
            b.pago_no_ciclo, b.ultimo_pagamento_em, b.pagamento_apos_previsao_em, b.parcelas_pagas,
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
    r.entrada_oferta, r.entrada_valor, r.entrada_pago_em,
    -- ---- novas (0214) — a reconciliação que faltava ----
    r.pagamento_previsto_em,
    CASE
        WHEN r.quitado_em IS NOT NULL THEN 'quitado'::text
        WHEN r.pagamento_previsto_em IS NULL THEN 'aguardando'::text
        -- venceu, mas caiu pagamento do MESMO produto DEPOIS da data combinada: em dia de fato.
        WHEN r.pagamento_previsto_em < CURRENT_DATE AND r.pagamento_apos_previsao_em IS NOT NULL THEN 'em_dia'::text
        WHEN r.pagamento_previsto_em < CURRENT_DATE THEN 'atrasado'::text
        ELSE 'em_dia'::text
    END AS status_parcela
   FROM regra r
     LEFT JOIN LATERAL ( SELECT p.pago_em, p.valor, p.categoria FROM cs.hm_pagamentos p
          WHERE p.comprador_id = r.comprador_id AND (p.categoria = ANY (ARRAY['mensalidade'::text, 'saldo'::text, 'compra_cheia'::text])) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
          ORDER BY p.pago_em DESC LIMIT 1) ab ON true;

revoke insert, update, delete on cs.vw_hm_financeiro from disparos_app;
grant select on cs.vw_hm_financeiro to disparos_app;

-- ── Verificação (rodar à mão — não faz parte da migration) ──────────────────
--
-- -- reproduz a medição do Marcio: quantos cards vencidos são falso positivo,
-- -- agora com o filtro por produto (um pagamento do AURUM não resgata o HM)
-- select
--   count(*) filter (where pagamento_previsto_em < current_date) as vencidos,
--   count(*) filter (where status_parcela = 'atrasado')          as atraso_real,
--   count(*) filter (where pagamento_previsto_em < current_date
--                     and status_parcela = 'em_dia')             as falso_positivo_corrigido
-- from cs.vw_hm_financeiro;
