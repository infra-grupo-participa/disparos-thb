-- =====================================================================
-- 0283_vencimento_da_parcela_e_inadimplencia_na_view_financeira
--
-- D3 (decisão do Marcio): inadimplência (60 dias sem pagar) SÓ SINALIZA —
-- nunca move o card. É alerta em cs.hm_alertas (fora desta migration, ver a
-- de número 0284+ do catálogo/health-check), e é leitura no board/ficha via
-- estas três colunas novas na view financeira:
--
--   proxima_cobranca_em — quando a próxima parcela é esperada. NULL quando
--     não há o que prever: quitou (quitado_em preenchido) ou não está numa
--     mensalidade em curso (situacao <> 'mensalidade_em_curso' — inclui
--     quem parcelou pela HOTMART, ver abaixo). Quando aplicável:
--     `(ultimo_pagamento_em at time zone 'America/Sao_Paulo')::date +
--     interval '1 month'` — cadência MENSAL, não +30 dias corridos: medido
--     pelo pedido (14 de 17 intervalos reais entre 26–35 dias, média 26,2 —
--     mais perto de "todo mês" do que de "a cada 30 dias corridos", e
--     +1 month acompanha o calendário (dia 5 de todo mês), que é como o
--     comercial de fato agenda cobrança).
--
--   dias_sem_pagar — `current_date - (ultimo_pagamento_em at time zone
--     'America/Sao_Paulo')::date`, só para quem está em
--     'mensalidade_em_curso'. NULL para os demais (não é zero — é "a
--     pergunta não se aplica a este card").
--
--   inadimplente — dias_sem_pagar >= 60. FALSE (não NULL) para quem a
--     pergunta não se aplica, para o board poder pintar direto sem tratar
--     3 estados.
--
-- ⚠️ QUEM PARCELOU NO CARTÃO (HOTMART_INSTALLMENTS) NÃO ENTRA NESTA RÉGUA.
-- `situacao` já classifica esse caso como 'quitado' (regra pré-existente:
-- ver cs.fn_hm_pode_finalizar, migration 0221 — compra HOTMART_INSTALLMENTS
-- aprovada já libera a Ativação) — a Hotmart repassa a parcela à vista para
-- o THB de uma vez, o parcelamento é entre o aluno e a Hotmart/operadora do
-- cartão, e o sistema não tem (nem precisa ter) visibilidade de quando cada
-- parcela do CARTÃO cai. Cobrar "próxima parcela" ou "inadimplência" dessas
-- pessoas seria o sistema inventar uma régua sobre um contrato que não é
-- dele. Só entra quem está de fato em 'mensalidade_em_curso' — mensalidade
-- LANÇADA no razão (cs.hm_pagamentos, categoria 'mensalidade'), que é
-- exatamente o crédito com base parcelado combinado com o comercial.
--
-- ⚠️ `at time zone 'America/Sao_Paulo'` obrigatório — mesma lição da 0214:
-- servidor em UTC, pix pago às 21h de Brasília vira D+1 sem a conversão, e
-- isso empurraria `proxima_cobranca_em`/zeraria `dias_sem_pagar` um dia
-- inteiro errado para quem pagou à noite.
--
-- ⚠️ `create or replace`, NUNCA `drop cascade` — cs.vw_aluno_360 (schema
-- GPS) depende desta view (fora deste repo). Colunas novas vão para o FIM
-- do SELECT: create-or-replace de view não deixa inserir no meio nem trocar
-- tipo/nome das colunas existentes, só acrescentar.
--
-- ⚠️ FONTE DO CORPO: este arquivo parte do texto da migration 0214 (o
-- último CREATE OR REPLACE completo encontrado no repo para esta view) —
-- NÃO foi possível, nesta rodada, confirmar contra `pg_get_viewdef` no
-- banco vivo (sem acesso a DATABASE_URL/MCP do Supabase nesta sessão; ver
-- precedente idêntico documentado na migration 0221). A regra de ouro deste
-- repo é clara: o banco pode estar à frente do arquivo. ANTES DE APLICAR,
-- rodar `select pg_get_viewdef('cs.vw_hm_financeiro'::regclass, true)` e
-- comparar coluna a coluna com o bloco abaixo (até a linha marcada "fim do
-- corpo herdado da 0214") — se divergir, reconstruir a partir do texto real
-- e só então acrescentar as 3 colunas novas ao fim.
-- =====================================================================

create or replace view cs.vw_hm_financeiro as
 WITH base AS (
         SELECT ch.id AS contato_hm_id, ch.comprador_id, cp.nome, cp.email, ch.turma,
            ch.turma_origem, ch.estagio_id, ch.valor_total,
            COALESCE(ch.valor_pago, 0::numeric) AS pago,
            ch.quitado_em, ch.oferta_saldo_codigo, ch.link_saldo_enviado_em,
            ch.cancelamento_efetivado_em, ch.acesso_preexistente, ch.credito_valor_pago,
            ch.credito_compra_em, ch.produto,
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
    r.pagamento_previsto_em,
    CASE
        WHEN r.quitado_em IS NOT NULL THEN 'quitado'::text
        WHEN r.pagamento_previsto_em IS NULL THEN 'aguardando'::text
        WHEN r.pagamento_previsto_em < CURRENT_DATE AND r.pagamento_apos_previsao_em IS NOT NULL THEN 'em_dia'::text
        WHEN r.pagamento_previsto_em < CURRENT_DATE THEN 'atrasado'::text
        ELSE 'em_dia'::text
    END AS status_parcela
    -- ── fim do corpo herdado da 0214 — conferir contra pg_get_viewdef antes de aplicar ──
    ,
    -- ---- novas (0283) — vencimento da parcela e inadimplência (D3, só sinaliza) ----
    -- `situacao` é resolvida acima na MESMA query (a coluna `situacao` deste
    -- SELECT) — reaproveitada aqui via CASE próprio porque SQL não permite
    -- referenciar o alias de uma coluna irmã dentro do mesmo nível de SELECT;
    -- repete a MESMA condição (exists mensalidade lançada) para não divergir.
    CASE
        WHEN r.quitado_em IS NOT NULL THEN NULL::timestamptz
        WHEN NOT (EXISTS ( SELECT 1 FROM cs.hm_pagamentos p
              WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)))
            THEN NULL::timestamptz
        ELSE ((r.ultimo_pagamento_em AT TIME ZONE 'America/Sao_Paulo')::date + interval '1 month')::timestamptz
    END AS proxima_cobranca_em,
    CASE
        WHEN r.quitado_em IS NOT NULL THEN NULL::integer
        WHEN NOT (EXISTS ( SELECT 1 FROM cs.hm_pagamentos p
              WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)))
            THEN NULL::integer
        WHEN r.ultimo_pagamento_em IS NULL THEN NULL::integer
        ELSE (CURRENT_DATE - (r.ultimo_pagamento_em AT TIME ZONE 'America/Sao_Paulo')::date)::integer
    END AS dias_sem_pagar,
    CASE
        WHEN r.quitado_em IS NOT NULL THEN false
        WHEN NOT (EXISTS ( SELECT 1 FROM cs.hm_pagamentos p
              WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)))
            THEN false
        WHEN r.ultimo_pagamento_em IS NULL THEN false
        ELSE (CURRENT_DATE - (r.ultimo_pagamento_em AT TIME ZONE 'America/Sao_Paulo')::date) >= 60
    END AS inadimplente
   FROM regra r
     LEFT JOIN LATERAL ( SELECT p.pago_em, p.valor, p.categoria FROM cs.hm_pagamentos p
          WHERE p.comprador_id = r.comprador_id AND (p.categoria = ANY (ARRAY['mensalidade'::text, 'saldo'::text, 'compra_cheia'::text])) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
          ORDER BY p.pago_em DESC LIMIT 1) ab ON true;

revoke insert, update, delete on cs.vw_hm_financeiro from disparos_app;
grant select on cs.vw_hm_financeiro to disparos_app;

comment on view cs.vw_hm_financeiro is
  '0283 acrescenta proxima_cobranca_em/dias_sem_pagar/inadimplente ao fim do SELECT (D3: so sinaliza, nunca move card). Regra: so calculado para quem tem mensalidade LANCADA no razao (mensalidade_em_curso) e nao quitou; quem parcelou pela HOTMART (HOTMART_INSTALLMENTS) e classificado quitado por fn_hm_pode_finalizar e NAO entra nesta regua. Cadencia mensal (+ interval 1 month sobre ultimo_pagamento_em em America/Sao_Paulo), nao +30 dias corridos.';

-- ── Verificação (rodar à mão — não faz parte da migration) ──────────────────
--
-- select count(*) filter (where inadimplente) as inadimplentes,
--        count(*) filter (where situacao = 'mensalidade_em_curso' and proxima_cobranca_em is null) as suspeitos_sem_previsao,
--        count(*) filter (where dias_sem_pagar is not null and dias_sem_pagar < 0) as datas_no_futuro_bug
-- from cs.vw_hm_financeiro;
