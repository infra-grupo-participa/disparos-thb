-- 0194_prorata_aurum_planilha_11_08.sql
-- PRÓ-RATA DO AURUM: a planilha do Victor passa a ser a verdade, e o BOARD passa a
-- mostrá-la.
--
-- Fonte: "[ETHB_2026 - SP] CONTROLE DE PAGAMENTO - AURUM.xlsx", aba "VICTOR Cálculo
-- do pagamento - A", baixada em 11/08/2026 20:38. 35 pessoas — exatamente as 35 do
-- board do AURUM (casaram 1:1 por e-mail; nenhum card órfão, nenhuma linha sobrando).
--
-- ---------------------------------------------------------------------------
-- OS DOIS PROBLEMAS QUE ISTO RESOLVE
--
-- 1) O CRÉDITO ESTAVA DESATUALIZADO. O import de 10/08 (0158/0162) gravou crédito =
--    valor pago − consumido (pró-rata puro). A planilha de hoje mudou o critério para
--    quem pagou o programa de implementação do HM: o crédito é o valor pago INTEIRO,
--    sem abater o consumo. Confirmado pelo Marcio em 11/08 — vale a aba de cálculo,
--    não a aba "Links" (que ainda repete os números de ontem).
--
--      pessoa                    credito ontem -> hoje        saldo ontem -> hoje
--      Magda / Leandro / Ana Paula   12.034,03 -> 13.072,68   46.965,97 -> 45.927,32
--      Jessica Bronze                 8.335,71 ->  9.082,19   50.664,29 -> 49.917,81
--      Sonia M B Gentil               6.580,97 ->  7.191,78   52.419,03 -> 51.808,22
--      Nelson Taborda                    (sem) ->     300,00  59.000,00 -> 58.700,00
--
--    Erico Ribeiro segue com o pró-rata calculado por fórmula (6.123,29) — a planilha
--    não mudou a linha dele.
--
-- 2) O BOARD IGNORAVA O CRÉDITO. `cs.vw_hm_financeiro` calculava, para AURUM,
--    `saldo_a_perseguir = 60.000 − pago`, ou seja **59.000 para todo mundo** — o
--    crédito só aparecia na ficha do card (`cs.vw_aurum_saldo`, lida pelo drawer em
--    lib/services/hm-ficha.ts:194). Board, tabela e export mostravam um número; a
--    ficha, outro. Agora o AURUM lê o saldo da planilha nos três lugares.
--
--    O saldo do AURUM passa a ser lido PRONTO de `cs.vw_aurum_saldo` (59.000 − crédito)
--    em vez de recalculado por `pacote − pago`. É de propósito: o link de pagamento é
--    gerado com o valor da planilha, e recalcular pelo pago real produzia divergência
--    de centavos (quem pagou 999,97 de entrada, não 1.000,00).
--
--    Exceção (`excecao = true`) continua sem saldo: NULL = "não cobrar", que é o que a
--    ficha já dizia. São 3 hoje — Erico (em revisão pelo comercial), Iara Célia
--    (gratuidade liberada pelo Marcio e Elaine — confirmado por ele em 11/08, apesar de
--    a planilha cravar 59.000 na coluna de saldo) e Marcelo Sitonio (cancelou).
--
-- ---------------------------------------------------------------------------
-- MEDIDO ANTES DE APLICAR (11/08/2026)
--   · cards com produto AURUM ................................. 35
--   · linhas em cs.aurum_pagamento_aluno ...................... 35  (casam 1:1 por e-mail)
--   · cards com pacote cravado (valor_total) ................... 0  (nada a atropelar)
--   · saldo que o board mostra hoje ....... 59.000 para os 35, inclusive quem tem crédito
--   · pessoas cujo saldo muda de VALOR ......................... 6  (as da tabela acima)
--
-- Idempotente: roda de novo sem efeito. Escreve só em cs.aurum_pagamento_aluno (a
-- tabela-espelho da planilha) e na view — NÃO toca cs.contatos_hm, então não passa
-- perto de cs.fn_hm_recalcular_financeiro, que atualiza card por comprador_id sem
-- filtrar produto e reescreveria o card errado de quem tem HM e AURUM ao mesmo tempo.

-- ---------------------------------------------------------------------------
-- 1) Foto do antes (append-only, prova de quem devia quanto)
-- ---------------------------------------------------------------------------
insert into cs.hm_financeiro_marco (marco, contato_hm_id, pacote_regra, saldo_a_perseguir, situacao)
select 'pre-prorata-aurum-11ago', f.contato_hm_id, f.pacote_regra, f.saldo_a_perseguir, f.situacao
  from cs.vw_hm_financeiro f
  join cs.contatos_hm ch on ch.id = f.contato_hm_id
 where ch.produto = 'AURUM'
on conflict (marco, contato_hm_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) A planilha entra na tabela-espelho
--
-- Casamento por E-MAIL: o documento da planilha vem sem o zero à esquerda em 9 das 35
-- linhas ("1559535911" x "01559535911"), o e-mail não tem essa ambiguidade.
--
-- `credito` vem da coluna N (Crédito pró-rata). Quando ela está vazia mas a coluna O
-- (Saldo a pagar) traz número — caso do Nelson, 58.700 —, o crédito é o que falta para
-- a base de 59.000: a coluna de saldo é a que a operação usa para gerar o link.
--
-- `excecao` NÃO é tocada: quem está marcado como "não cobrar" continua assim (decisão
-- do Marcio em 11/08 sobre a Iara). A planilha não sinalizou mudança de situação.
-- ---------------------------------------------------------------------------
with planilha(email, credito, valor_pago, dias_totais, dias_usados, valor_dia, consumido, saldo_planilha, situacao, obs) as (values
  ('contato@marcosadrianomarques.com', null::numeric, null::numeric, null::int, null::int, null::numeric, null::numeric, null::numeric, 'SEM CRÉDITO', 'Assinatura (mensal, em atraso) — definir valor de crédito manualmente'),
  ('mariajliberato@hotmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('eduardo@borgescardoso.adv.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('patricia@jbleopoldino.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('manuel@dgr.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('costaborges@aasp.org.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('magdamoraisadv@gmail.com', 13072.68, 13072.68, 365, 29, 35.82, 1038.65, 45927.32, 'TEM CRÉDITO', 'Pagou 13072 no programa de implementação'),
  ('gilmarafonso@gmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada'),
  ('marceloxsitonio@gmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Cancelou'),
  ('andersonsilvaresende@outlook.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('swyano@yahoo.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('escritorioerico@hotmail.com', 6123.29, 15000, 365, 216, 41.10, 8876.71, 52876.71, 'REVISAR', 'Já era Aurum, pagou renovação 2026 do Aurum'),
  ('clscastro.almeida@hotmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('drmarcelocontabil@uol.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('kkosam0512@gmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Assinatura (mensal, em atraso) — definir valor de crédito manualmente'),
  ('dalesgaldino@yahoo.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('roberto@prradvogados.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada'),
  ('humbertomarinhoadv@hotmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('balbinavasconcelos@hotmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('marli@oliveiranascimentoadv.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('bronze.jessica@hotmail.com', 9082.19, 9082.19, 365, 30, 24.88, 746.48, 49917.81, 'TEM CRÉDITO', 'Pagou 9082,19 no programa de implementação'),
  ('pauleteagrooeste@hotmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('fatimaantunes74@gmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('iaracbcastro.adv@gmail.com', null, null, null, null, null, null, 59000, 'REVISAR', 'Gratuidade liberada pelo Marcio e Elaine na Imersão de GO'),
  ('marianenascimento@hotmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('tabordaoficial@gmail.com', null, null, null, null, null, null, 58700, 'SEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)'),
  ('renato_habara@uol.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('leandroassuncao_adv@hotmail.com', 13072.68, 13072.68, 365, 29, 35.82, 1038.65, 45927.32, 'TEM CRÉDITO', 'Pagou 13072 no programa de implementação'),
  ('contato@advocaciarodrigomaciel.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada'),
  ('apkfuri@gmail.com', 13072.68, 13072.68, 365, 29, 35.82, 1038.65, 45927.32, 'TEM CRÉDITO', 'Pagou 13072 no programa de implementação'),
  ('vandaamorimadv@gmail.com', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Sócio — crédito calculado sobre o titular (Luis Carlos Fariñas Nantes)'),
  ('claudiethomaz@bol.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', null),
  ('adv@veziocunha.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Assinatura (mensal, em atraso) — definir valor de crédito manualmente'),
  ('chriselima@yahoo.com.br', null, null, null, null, null, null, null, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada'),
  ('soniambgentil@gmail.com', 7191.78, 7191.78, 365, 31, 19.70, 610.81, 51808.22, 'TEM CRÉDITO', 'Pagou 7191,78 no programa de implementação')
), base as (
  select (select valor from cs.aurum_parametros where chave = 'pacote_cheio')
       - (select valor from cs.aurum_parametros where chave = 'entrada') as base_saldo
), alvo as (
  select p.*,
         -- coluna N quando existe; senão, o que a coluna O (saldo) implica
         coalesce(p.credito, case when p.saldo_planilha is not null then b.base_saldo - p.saldo_planilha end) as credito_final
    from planilha p cross join base b
)
update cs.aurum_pagamento_aluno a
   set credito       = alvo.credito_final,
       valor_pago    = alvo.valor_pago,
       dias_totais   = alvo.dias_totais,
       dias_usados   = alvo.dias_usados,
       valor_dia     = alvo.valor_dia,
       consumido     = alvo.consumido,
       situacao      = alvo.situacao,
       obs           = coalesce(alvo.obs, a.obs),
       atualizado_em = now()
  from alvo
 where lower(trim(a.email)) = alvo.email
   and (a.credito       is distinct from alvo.credito_final
     or a.valor_pago    is distinct from alvo.valor_pago
     or a.dias_usados   is distinct from alvo.dias_usados
     or a.consumido     is distinct from alvo.consumido
     or a.situacao      is distinct from alvo.situacao);

-- ---------------------------------------------------------------------------
-- 3) O board passa a enxergar o saldo do AURUM
--
-- Duas mudanças cirúrgicas em cs.vw_hm_financeiro; o resto é o texto que estava em
-- produção (0179 + 0184), preservado linha a linha:
--   (a) CTE `base` ganha `aurum_saldo`, vindo da tabela-espelho da planilha por
--       LATERAL com ORDER BY + LIMIT 1 (subquery escalar sem limite já derrubou a
--       view inteira com ERROR 21000 na 0168 — não repetir);
--   (b) `saldo_a_perseguir` ganha um ramo AURUM que devolve esse valor. Pacote
--       cravado no card, se algum dia existir, continua vencendo.
-- ---------------------------------------------------------------------------
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
            -- [0194] AURUM: o saldo vem PRONTO da planilha do Victor (cs.aurum_pagamento_aluno,
            -- a mesma fonte da ficha). excecao = "nao cobrar" -> NULL, nunca zero.
            -- Sem linha na planilha (venda nova do Aurum), cai no saldo cheio de 59.000.
                CASE
                    WHEN ch.produto = 'AURUM'::text AND COALESCE(aur.excecao, false) THEN NULL::numeric
                    WHEN ch.produto = 'AURUM'::text THEN round((( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'pacote_cheio'::text) - ( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'entrada'::text)) - COALESCE(aur.credito, 0::numeric), 2)
                    ELSE NULL::numeric
                END AS aurum_saldo,
            ( SELECT COALESCE(sum(p.valor), 0::numeric) AS "coalesce"
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto) AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em) AND NOT (ent.pago_em IS NOT NULL AND p.pago_em < ent.pago_em AND p.categoria = 'sinal'::text AND p.oferta_codigo IS DISTINCT FROM ent.oferta_codigo)) AS pago_no_ciclo,
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
                  ORDER BY p.pago_em DESC, p.valor DESC, p.id DESC
                 LIMIT 1) ent ON true
             LEFT JOIN LATERAL ( SELECT a.credito,
                    a.excecao
                   FROM cs.aurum_pagamento_aluno a
                  WHERE a.comprador_id = ch.comprador_id
                  ORDER BY a.atualizado_em DESC, a.documento
                 LIMIT 1) aur ON ch.produto = 'AURUM'::text
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
            b.aurum_saldo,
            b.pago_no_ciclo,
            b.ultimo_pagamento_em,
            b.parcelas_pagas,
            b.parcelas_contratadas,
            b.valor_parcela,
                CASE
                    WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                    ELSE b.credito_hoje
                END AS credito,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN ( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'pacote_cheio'::text)
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote -
                    CASE
                        WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                        ELSE COALESCE(b.credito_hoje, 0::numeric)
                    END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 15000::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS pacote_regra,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN b.aurum_saldo
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote - b.entrada_pago -
                    CASE
                        WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                        ELSE COALESCE(b.credito_hoje, 0::numeric)
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
        -- [0194] AURUM: saldo da planilha (NULL quando "nao cobrar"). Pacote cravado
        -- no card continua vencendo, aqui como nos outros produtos.
        CASE
            WHEN r.produto = 'AURUM'::text THEN COALESCE(
                CASE
                    WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
                    ELSE NULL::numeric
                END, r.aurum_saldo)
            ELSE COALESCE(
                CASE
                    WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
                    ELSE NULL::numeric
                END,
                CASE
                    WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0::numeric)
                    ELSE NULL::numeric
                END)
        END AS saldo_a_perseguir,
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

-- A 0178 revogou escrita nas views financeiras; CREATE OR REPLACE recria os grants
-- de leitura, mas o REVOKE precisa ser reafirmado para a view não voltar gravável.
revoke insert, update, delete on cs.vw_hm_financeiro from disparos_app;
grant select on cs.vw_hm_financeiro to disparos_app;

-- ---------------------------------------------------------------------------
-- 4) Timeline: quem mudou de saldo ganha registro
-- ---------------------------------------------------------------------------
insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select ch.id, 'sistema',
       'Pró-rata do AURUM atualizado pela planilha de 11/08: crédito R$ '
       || to_char(coalesce(a.credito, 0), 'FM999G999D00')
       || ' · saldo R$ ' || to_char(coalesce(s.saldo_a_pagar, 0), 'FM999G999D00'),
       'sistema'
  from cs.contatos_hm ch
  join cs.aurum_pagamento_aluno a on a.comprador_id = ch.comprador_id
  join cs.vw_aurum_saldo s on s.documento = a.documento
  join cs.hm_financeiro_marco m on m.contato_hm_id = ch.id and m.marco = 'pre-prorata-aurum-11ago'
 where ch.produto = 'AURUM'
   and coalesce(s.saldo_a_pagar, -1) is distinct from coalesce(m.saldo_a_perseguir, -1)
   and not exists (
     select 1 from cs.interacoes i
      where i.contato_hm_id = ch.id
        and i.descricao like 'Pró-rata do AURUM atualizado pela planilha de 11/08:%');

-- ---------------------------------------------------------------------------
-- 5) Conferência — board tem de bater com a ficha, para os 35
-- ---------------------------------------------------------------------------
do $$
declare
  v_divergentes int; v_cards int; v_mudaram int; v_excecao int;
begin
  select count(*) into v_cards from cs.contatos_hm where produto = 'AURUM';

  select count(*) into v_divergentes
    from cs.contatos_hm ch
    join cs.vw_hm_financeiro f on f.contato_hm_id = ch.id
    join cs.aurum_pagamento_aluno a on a.comprador_id = ch.comprador_id
    join cs.vw_aurum_saldo s on s.documento = a.documento
   where ch.produto = 'AURUM'
     and f.saldo_a_perseguir is distinct from s.saldo_a_pagar;

  select count(*) into v_mudaram
    from cs.hm_financeiro_marco m
    join cs.vw_hm_financeiro f on f.contato_hm_id = m.contato_hm_id
   where m.marco = 'pre-prorata-aurum-11ago'
     and f.saldo_a_perseguir is distinct from m.saldo_a_perseguir;

  select count(*) into v_excecao from cs.aurum_pagamento_aluno where excecao;

  raise notice '0194: % cards AURUM · % com saldo alterado · % em excecao (nao cobrar)',
    v_cards, v_mudaram, v_excecao;

  if v_divergentes > 0 then
    raise exception '0194: % cards do AURUM com board != ficha — a view nao esta lendo a planilha', v_divergentes;
  end if;
end $$;
