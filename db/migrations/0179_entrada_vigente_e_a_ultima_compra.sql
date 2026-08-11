-- 0179 — a entrada vigente do aluno e a ULTIMA compra, nao a primeira.
--
-- ⚠️ ESTE ARQUIVO E O REGISTRO CONSOLIDADO DO QUE JA FOI APLICADO EM PRODUCAO
-- em 11/08/2026, atraves de 4 chamadas de apply_migration que entraram em
-- supabase_migrations.schema_migrations com estes nomes:
--     20260811133300  0167_entrada_vigente_e_a_ultima_financeiro
--     20260811133405  0167_entrada_vigente_e_a_ultima_kanban
--     20260811133523  0168_ciclo_descarta_so_entrada_antiga           (corrigida pela seguinte)
--     20260811133636  0169_ciclo_descarta_so_sinal_de_oferta_substituida
-- Os numeros 0167/0168/0169 JA ESTAVAM EM USO por migrations de 10/08 (canal por janela
-- da oferta, pagamento do produto, produto por oferta). A ordem de aplicacao ficou certa
-- porque o timestamp e posterior, mas o NOME colidiu. Este arquivo renumera para 0179,
-- que e o proximo numero livre de verdade (producao ja tinha ate 0178).
-- Ao reaplicar do zero, use SOMENTE este arquivo — ele ja contem o estado final,
-- com a correcao da 0168 embutida (ver bloco REGRESSOES abaixo).
--
-- ⚠️ DRIFT REPO x PRODUCAO: as migrations 0167..0178 existem SO NO BANCO, nunca foram
-- versionadas aqui. O ultimo arquivo do repo era o 0166. Alem disso a
-- 0166_saldo_da_oferta_697.sql esta SUPERADA: producao ja havia generalizado o ramo
-- hard-coded `entrada_697`/`rlgjsrul` para hm_product_catalog.pacote_cheio e
-- .entrada_condicao_fechada. Este arquivo foi escrito sobre o pg_get_viewdef REAL.
-- NUNCA reaplicar a 0166 por cima deste.
--
-- ── O CASO ────────────────────────────────────────────────────────────────────────
-- Adreiza Farias de Oliveira (adreizza@gmail.com), card HM:
--   27/07/2026  sinal R$ 300,00  oferta z391kxd9  (pacote_cheio 15.000, condicao_fechada false)
--   11/08/2026  sinal R$ 697,00  oferta rlgjsrul  (pacote_cheio 15.000, condicao_fechada TRUE)
-- O card exibia a entrada de 300 e o financeiro ficava 'incalculavel'. Ela recomprou e
-- quem mandava era a compra velha.
--
-- ── A CAUSA ───────────────────────────────────────────────────────────────────────
-- Dois ORDER BY sem DESC, que elegiam a entrada MAIS ANTIGA:
--   1. cs.vw_hm_financeiro   — LATERAL `ent`: ORDER BY p.pago_em, p.oferta_codigo, p.id
--   2. cs.contatos_hm_kanban — LATERAL `s`  : ORDER BY (COALESCE(c.data_compra, c.data_aprovacao))
-- (o LATERAL vizinho `hs`, do hotmart_status, sempre usou DESC NULLS LAST — era esquecimento.)
--
-- O LATERAL `s` do kanban tinha um segundo defeito: lia public.compras SEM filtrar por
-- produto. So trocar para DESC faria os 12 cards HM de quem depois comprou a Taxa Aurum
-- ETHB SP (qm4lu7py) exibirem a entrada do Aurum como sinal do card HM. Por isso ele passa
-- a ler cs.hm_pagamentos com cs.fn_hm_pagamento_do_produto, igual ao resto do financeiro —
-- uma fonte de verdade duplicada a menos.
--
-- ── A REGRA (decisao do Marcio, 11/08/2026) ───────────────────────────────────────
-- a) Prevalece SEMPRE a ultima compra de entrada, valor maior OU menor, dentro do MESMO
--    produto. Aurum e HM sao produtos distintos e nao se contaminam.
-- b) O que foi pago numa entrada ANTERIOR nao abate o saldo — a entrada vigente reinicia
--    o ciclo. Adreiza pagou 300 + 697 = 997, mas o saldo dela e 15.000 - 697 = 14.303,00
--    (e nao 14.003).
--
-- ── REGRESSOES PEGAS NA VERIFICACAO (o motivo do corte ser tao estreito) ──────────
-- A 1a versao do corte descartava TUDO anterior a entrada vigente, e a 2a descartava
-- 'sinal' + 'compra_cheia'. As duas quebraram gente que estava certa:
--
--   Guilherme Henrique Canal da Rocha — 2.000 (sinal, 15/06) -> 13.000 (COMPRA_CHEIA,
--     30/06) -> 300,01 (sinal, 07/07). Descartar compra_cheia anterior jogava fora os
--     13.000 e RESSUSCITAVA divida de 2.042,46 em quem estava QUITADO. compra_cheia e
--     pagamento do pacote, nao entrada substituivel: nunca sai do ciclo.
--
--   Eliane Lobato Peixoto Borges — pagou o MESMO sinal (oferta z391kxd9) duas vezes,
--     08/07 e 27/07. Isso e recobranca/duplicidade, nao recompra. Descartar a 1a subia o
--     saldo dela em 300. Se a oferta e a MESMA da vigente, o dinheiro continua abatendo.
--
-- Corte final: sai do ciclo APENAS o pagamento de categoria 'sinal', anterior a entrada
-- vigente, E de oferta DIFERENTE da vigente — ou seja, so a entrada efetivamente
-- SUBSTITUIDA por outra.
--
-- ── VERIFICACAO EM PRODUCAO (284 cards) ──────────────────────────────────────────
--   cards com saldo_a_perseguir alterado ... 1  (so a Adreiza)
--   delta total do board .................... +14.303,00  (era NULL, virou 14.303,00)
--   cards com pacote cravado desrespeitado .. 0
--   'incalculavel' .......................... 30 -> 29
--   public.vw_aluno_360 ..................... 1.812 linhas, intacta
--   grants da 0178 .......................... preservados (disparos_app segue com `r`)

begin;

-- 1) FINANCEIRO ------------------------------------------------------------------
create or replace view cs.vw_hm_financeiro as
 WITH base AS (
         SELECT ch.id AS contato_hm_id,
            ch.comprador_id,
            cp.nome,
            cp.email,
            ch.turma,
            ch.turma_origem,
            ch.estagio_id,
            ch.valor_total,
            COALESCE(ch.valor_pago, 0::numeric) AS pago,
            ch.quitado_em,
            ch.oferta_saldo_codigo,
            ch.link_saldo_enviado_em,
            ch.cancelamento_efetivado_em,
            ch.acesso_preexistente,
            ch.credito_valor_pago,
            ch.credito_compra_em,
            ch.produto,
                CASE
                    WHEN 'Aluno THB'::text = ANY (ch.tags) THEN 'aluno_base'::text
                    WHEN 'Aluno Aurum'::text = ANY (ch.tags) THEN 'aluno_base'::text
                    WHEN 'Lead novo'::text = ANY (ch.tags) THEN 'lead_novo'::text
                    ELSE 'nao_classificado'::text
                END AS publico,
            ent.oferta_codigo AS entrada_oferta,
            ent.pacote_cheio AS entrada_pacote,
            ent.valor AS entrada_valor,
            ent.pago_em AS entrada_pago_em,
            COALESCE(ent.condicao_fechada, false) AS entrada_fechada,
            COALESCE(( SELECT sum(p3.valor) AS sum
                   FROM cs.hm_pagamentos p3
                  WHERE p3.comprador_id = ch.comprador_id AND p3.oferta_codigo = ent.oferta_codigo), 0::numeric) AS entrada_pago,
            ( SELECT pr.credito
                   FROM cs.fn_hm_prorata(ch.comprador_id) pr(dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar)) AS credito_hoje,
            -- 0179: sai do ciclo APENAS a entrada substituida — categoria 'sinal',
            -- anterior a vigente e de OFERTA DIFERENTE. compra_cheia, saldo, mensalidade
            -- e recobranca da mesma oferta continuam abatendo (ver REGRESSOES no topo).
            ( SELECT COALESCE(sum(p.valor), 0::numeric) AS "coalesce"
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id
                    AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
                    AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)
                    AND NOT (
                          ent.pago_em IS NOT NULL
                      AND p.pago_em < ent.pago_em
                      AND p.categoria = 'sinal'::text
                      AND p.oferta_codigo IS DISTINCT FROM ent.oferta_codigo
                    )) AS pago_no_ciclo,
            ( SELECT max(p.pago_em) AS max
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS ultimo_pagamento_em,
            (( SELECT count(*) AS count
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)))::integer AS parcelas_pagas,
            (( SELECT max(c.parcelas) AS max
                   FROM compras c
                  WHERE c.comprador_id = ch.comprador_id AND (c.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text, 'COMPLETED'::text])) AND c.metodo_pagamento::text = 'HOTMART_INSTALLMENTS'::text))::integer AS parcelas_contratadas,
            ( SELECT max(p.valor) AS max
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS valor_parcela
           FROM cs.contatos_hm ch
             JOIN compradores cp ON cp.id = ch.comprador_id
             LEFT JOIN LATERAL ( SELECT p.oferta_codigo,
                    cat.pacote_cheio,
                    p.valor,
                    p.pago_em,
                    cat.entrada_condicao_fechada AS condicao_fechada
                   FROM cs.hm_pagamentos p
                     JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
                  WHERE p.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND cat.pacote_cheio IS NOT NULL AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto) AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)
                  -- 0179: DESC. A entrada vigente e a ULTIMA. Desempate deterministico
                  -- por valor e id para o resultado nao oscilar entre execucoes.
                  ORDER BY p.pago_em DESC, p.valor DESC, p.id DESC
                 LIMIT 1) ent ON true
        ), regra AS (
         SELECT b.contato_hm_id,
            b.comprador_id,
            b.nome,
            b.email,
            b.turma,
            b.turma_origem,
            b.estagio_id,
            b.valor_total,
            b.pago,
            b.quitado_em,
            b.oferta_saldo_codigo,
            b.link_saldo_enviado_em,
            b.cancelamento_efetivado_em,
            b.acesso_preexistente,
            b.credito_valor_pago,
            b.credito_compra_em,
            b.produto,
            b.publico,
            b.entrada_oferta,
            b.entrada_pacote,
            b.entrada_valor,
            b.entrada_pago_em,
            b.entrada_fechada,
            b.entrada_pago,
            b.credito_hoje,
            b.pago_no_ciclo,
            b.ultimo_pagamento_em,
            b.parcelas_pagas,
            b.parcelas_contratadas,
            b.valor_parcela,
                CASE
                    WHEN b.entrada_fechada THEN 0::numeric
                    WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                    ELSE b.credito_hoje
                END AS credito,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN ( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'pacote_cheio'::text)
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote -
                    CASE
                        WHEN b.entrada_fechada OR b.publico = 'lead_novo'::text THEN 0::numeric
                        ELSE b.credito_hoje
                    END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 15000::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS pacote_regra,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN (( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'pacote_cheio'::text)) - (( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'entrada'::text))
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote - b.entrada_pago -
                    CASE
                        WHEN b.entrada_fechada OR b.publico = 'lead_novo'::text THEN 0::numeric
                        ELSE b.credito_hoje
                    END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 14700::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(14700::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS saldo_regra
           FROM base b
        )
 SELECT r.contato_hm_id,
    r.comprador_id,
    r.nome,
    r.email,
    r.turma,
    r.turma_origem,
    r.estagio_id,
    r.publico,
    r.credito_valor_pago,
    r.credito_compra_em,
    r.credito,
    r.pacote_regra,
    r.saldo_regra,
    r.valor_total AS pacote_cravado,
    r.pago,
        CASE
            WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
            ELSE NULL::numeric
        END AS saldo_cravado,
    COALESCE(
        CASE
            WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
            ELSE NULL::numeric
        END,
        CASE
            WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0::numeric)
            ELSE NULL::numeric
        END) AS saldo_a_perseguir,
        CASE
            WHEN r.valor_total IS NOT NULL AND r.pacote_regra IS NOT NULL THEN round(r.valor_total - r.pacote_regra, 2)
            ELSE NULL::numeric
        END AS divergencia_regra,
    r.quitado_em IS NOT NULL AS quitado,
    r.cancelamento_efetivado_em IS NOT NULL AS cancelado,
    r.oferta_saldo_codigo,
    r.link_saldo_enviado_em IS NOT NULL AS oferta_enviada,
        CASE
            WHEN r.cancelamento_efetivado_em IS NOT NULL THEN 'cancelado'::text
            WHEN r.quitado_em IS NOT NULL THEN 'quitado'::text
            WHEN (EXISTS ( SELECT 1
               FROM cs.hm_pagamentos p
              WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto))) THEN 'mensalidade_em_curso'::text
            WHEN r.publico = 'aluno_base'::text AND r.credito_hoje IS NULL AND NOT r.entrada_fechada THEN 'incalculavel'::text
            WHEN r.link_saldo_enviado_em IS NOT NULL THEN 'oferta_enviada'::text
            ELSE 'saldo_parado'::text
        END AS situacao,
    r.pago_no_ciclo,
    r.ultimo_pagamento_em,
    r.parcelas_pagas,
    r.parcelas_contratadas,
    r.valor_parcela,
        CASE
            WHEN COALESCE(r.valor_total, r.pacote_regra) > 0::numeric THEN round(100::numeric * r.pago / COALESCE(r.valor_total, r.pacote_regra), 1)
            ELSE NULL::numeric
        END AS pago_pct,
    ab.pago_em AS ultimo_abatimento_em,
    ab.valor AS ultimo_abatimento_valor,
    ab.categoria AS ultimo_abatimento_categoria,
    -- 0179: colunas novas SO NO FIM. create or replace view nao reordena, e
    -- public.vw_aluno_360 depende desta view.
    r.entrada_oferta,
    r.entrada_valor,
    r.entrada_pago_em
   FROM regra r
     LEFT JOIN LATERAL ( SELECT p.pago_em,
            p.valor,
            p.categoria
           FROM cs.hm_pagamentos p
          WHERE p.comprador_id = r.comprador_id AND (p.categoria = ANY (ARRAY['mensalidade'::text, 'saldo'::text, 'compra_cheia'::text])) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
          ORDER BY p.pago_em DESC
         LIMIT 1) ab ON true;

-- 2) KANBAN ----------------------------------------------------------------------
-- ⚠️ s.valor tem cast para numeric(10,2): compras.preco e numeric(10,2) e
-- hm_pagamentos.valor e numeric(12,2). create or replace view nao permite trocar o tipo
-- de uma coluna que ja existe.
create or replace view cs.contatos_hm_kanban as
 SELECT ch.id AS contato_hm_id,
    ch.comprador_id,
    cmp.nome,
    cmp.email,
    cmp.telefone,
    ch.turma,
    ch.plano,
    ch.categoria_entrada,
    ch.estagio_id,
    est.chave AS estagio_chave,
    est.nome AS estagio_nome,
    est.aba AS estagio_aba,
    ch.responsavel,
    ch.reuniao_em,
    ch.reuniao_resultado,
    ch.entrevista_em,
    ch.entrevista_resultado,
    ch.pagamento_forma,
    ch.pagamento_parcelas,
    ch.pagamento_em,
    ch.apto_ativacao,
    ch.tags,
    ch.observacoes,
    ch.criado_em,
    ch.atualizado_em,
    ch.ordem,
    ch.turma_origem,
    ch.pagamento_meio,
    ch.pagamento_previsto_em,
    ch.acordo,
    ch.oferta_saldo_codigo,
    ch.link_saldo_enviado_em,
    ch.nao_contatar,
    ch.nao_contatar_motivo,
    ch.revisar,
    ch.revisar_motivo,
    ch.ativ_searchie,
    ch.ativ_comunidade,
    ch.ativ_grupo,
    ch.ativ_pesquisa,
    ch.grupo_informes,
    ch.pendencia,
    ch.cancelamento_em,
    ch.cancelamento_motivo,
    ch.link_facebook,
    s.pago_em AS sinal_pago_em,
    s.valor::numeric(10,2) AS sinal_valor,
    ch.cancelamento_efetivado_em,
    ch.cancelamento_origem,
    ch.rev_searchie,
    ch.rev_comunidade,
    ch.rev_grupo,
    ch.rev_pesquisa,
    ch.acessos_revogados_em,
    ch.acessos_revogados_por,
    ch.aluno_id,
    ch.cancelamento_efetivado_em IS NOT NULL AND ch.acessos_revogados_em IS NULL AS acessos_a_remover,
    ch.hotmart_cancelado_em,
    ch.hotmart_cancelamento_evento,
    ch.hotmart_cancelamento_transacao,
    ch.hotmart_cancelado_em IS NOT NULL AS cancelado_na_hotmart,
    ch.cancelamento_efetivado_em IS NOT NULL AND ch.hotmart_cancelado_em IS NULL AS cancelado_sem_confirmacao_hotmart,
    hs.status AS hotmart_status,
    hs.em AS hotmart_status_em,
    COALESCE(( SELECT t.t
           FROM unnest(ch.tags) t(t)
          WHERE t.t ~ '^HT[0-9]+$'::text
         LIMIT 1), ( SELECT t.t
           FROM unnest(ch.tags) t(t)
          WHERE t.t = ANY (ARRAY['HT ATM'::text, 'Live Direto ao Ponto'::text, 'Imersão POA'::text, 'Ex aluno Direto ao Ponto'::text, 'HM - Programa de Implementação'::text, 'Venda direta'::text])
          ORDER BY (array_position(ARRAY['HT ATM'::text, 'Live Direto ao Ponto'::text, 'Imersão POA'::text, 'Ex aluno Direto ao Ponto'::text, 'HM - Programa de Implementação'::text, 'Venda direta'::text], t.t))
         LIMIT 1)) AS canal_aquisicao,
    ch.reuniao_gravacao_url,
    ch.entrevista_gravacao_url,
    ch.responsavel_id,
    COALESCE(ru.equipe_id, peq.id, rota.equipe_id) AS equipe_id,
    COALESCE(deq.nome, peq.nome, req.nome) AS equipe_nome,
    COALESCE(deq.cor, peq.cor, req.cor) AS equipe_cor,
    COALESCE(deq.tipo, peq.tipo, req.tipo) AS equipe_tipo,
    ch.cancelamento_valor,
    ch.produto,
    -- 0179: coluna nova so no fim.
    s.oferta_codigo AS sinal_oferta_codigo
   FROM cs.contatos_hm ch
     JOIN compradores cmp ON cmp.id = ch.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ch.estagio_id
     LEFT JOIN cs.usuarios ru ON ru.id = ch.responsavel_id
     LEFT JOIN cs.equipes deq ON deq.id = ru.equipe_id
     LEFT JOIN cs.equipes peq ON peq.id = ch.equipe_padrao_id
     LEFT JOIN LATERAL ( SELECT ec.equipe_id
           FROM cs.equipe_canais ec
          WHERE ec.canal = ANY (ch.tags)
         LIMIT 1) rota ON true
     LEFT JOIN cs.equipes req ON req.id = rota.equipe_id
     -- 0179: era public.compras sem filtro de produto e com ORDER BY ASC. Agora le
     -- cs.hm_pagamentos (mesma fonte do financeiro), isola por produto e pega a ULTIMA.
     LEFT JOIN LATERAL ( SELECT p.pago_em,
            p.valor,
            p.oferta_codigo
           FROM cs.hm_pagamentos p
             JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
          WHERE p.comprador_id = ch.comprador_id
            AND cat.categoria = 'sinal'::text
            AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
          ORDER BY p.pago_em DESC NULLS LAST, p.valor DESC, p.id DESC
         LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT c.status,
            COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true;

comment on column cs.contatos_hm_kanban.sinal_valor is
  '0179: a entrada VIGENTE (a ULTIMA compra de entrada do MESMO produto), nao a primeira. Quem recompra passa a valer pela compra nova.';
comment on column cs.contatos_hm_kanban.sinal_pago_em is
  '0179: data da entrada VIGENTE (a ultima), nao da primeira. Tambem define o inicio do ciclo em cs.vw_hm_financeiro.pago_no_ciclo.';
comment on column cs.contatos_hm_kanban.sinal_oferta_codigo is
  '0179: codigo da oferta da entrada vigente. Use para exibir o rotulo real em vez do campo `plano`, que congela na 1a compra (ver cs.fn_seed_contato_hm).';

-- 3) ROTULO DO CARD DA ADREIZA ---------------------------------------------------
-- cs.fn_seed_contato_hm grava `plano` com coalesce(EXISTENTE, novo), entao o rotulo
-- congela na 1a compra e continuava dizendo "Sinal R$300" mesmo com a entrada vigente
-- ja sendo a de 697. Correcao pontual — o escopo medido era 1 card, nao ha backfill em
-- massa aqui. O congelamento em si segue aberto (ver PENDENCIA).
update cs.contatos_hm ch
   set plano = 'Entrada HM R$697 (ofertado na live do HT de 09/08/2026)',
       atualizado_em = now()
  from public.compradores cp
 where cp.id = ch.comprador_id
   and cp.email = 'adreizza@gmail.com'
   and ch.produto = 'HM'
   and ch.valor_total is null;

commit;

-- ── PENDENCIA (nao entrou nesta migration) ───────────────────────────────────────
-- 1. cs.fn_seed_contato_hm ainda faz coalesce(cs.contatos_hm.plano, excluded.plano) e
--    coalesce(...categoria_entrada...), congelando o rotulo na PRIMEIRA compra. A view ja
--    expoe sinal_oferta_codigo para o front nao depender de `plano`, mas a proxima
--    recompra vai congelar o rotulo de novo. Corrigir trocando para `excluded` restrito
--    ao mesmo produto.
-- 2. Os literais 14700/15000 seguem em cs.fn_hm_prorata, cs.fn_hm_valores_derivados,
--    cs.fn_hm_sugestao_financeira e no TypeScript (lib/services/hm-ficha.ts,
--    app/hm/_components/hm-drawer.tsx). Eles nao afetam o caso corrigido aqui porque o
--    ramo entrada_pacote vence antes, mas continuam sendo divida.
-- 3. cs.fn_hm_recalcular_financeiro nao filtra por produto (select into + update por
--    comprador_id): escreve nos dois cards de quem tem HM e AURUM. Nao foi acionada por
--    esta migration, mas trava qualquer backfill futuro em massa.
