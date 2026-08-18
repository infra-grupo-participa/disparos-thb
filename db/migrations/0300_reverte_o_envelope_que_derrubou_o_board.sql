-- 0300_reverte_o_envelope_que_derrubou_o_board
--
-- APLICADA EM PRODUCAO EM 18/08/2026, durante incidente.
--
-- ── O que aconteceu ─────────────────────────────────────────────────────────
-- A 0297 acrescentou ativ_gps ENVELOPANDO a view:
--     select v.*, ch2.ativ_gps from (<view inteira>) v
--       join cs.contatos_hm ch2 on ch2.id = v.contato_hm_id
--
-- Escolhi o envelope porque `create or replace view` recusava inserir a coluna
-- no meio da projecao (mudaria a ordem das 87 existentes). Foi erro de metodo:
-- o subselect vira BARREIRA DE OTIMIZACAO. O planner passa a materializar a
-- view inteira — com os 6 LATERAL, incluindo dois que varrem cs.hm_pagamentos
-- por comprador — ANTES de aplicar qualquer filtro. O `where produto='HM'` do
-- board deixou de ser empurrado para dentro.
--
-- Resultado: a view mais quente do sistema (lida a cada carregamento do board)
-- passou a dar timeout, saturou o pool de conexoes e derrubou Database,
-- PostgREST, Auth e Storage juntos. Precisou de restart do projeto.
--
-- ── A falha de verificacao (a licao) ────────────────────────────────────────
-- Depois de aplicar a 0297 eu conferi que a view RETORNAVA 305 linhas e dei
-- por bom. Nao medi QUANTO TEMPO levava. Correcao funcional verificada, custo
-- nao — e numa view desse tamanho o custo ERA o risco.
--
-- 🔑 Toda mudanca em view quente precisa de EXPLAIN ANALYZE antes e depois,
-- nao so de um count() que retorna.
--
-- ── A correcao ─────────────────────────────────────────────────────────────
-- ativ_gps vem do alias `ch`, que JA esta no FROM da view. Sem subselect, sem
-- join novo. A coluna fica NO FIM (attnum 88) — a mesma posicao que o envelope
-- ja lhe dava —, e por isso `create or replace` aceita sem drop.
--
-- ⚠️ NAO usar drop+create: 21 objetos dependem desta view. A primeira versao
-- desta migration tentou drop e foi abortada pela propria trava de dependencia
-- que eu havia escrito — ela evitou um estrago maior que o incidente original.
--
-- ── Medido depois de aplicar ────────────────────────────────────────────────
-- explain (analyze) select * from cs.contatos_hm_kanban where produto='HM' limit 100
--   -> Index Scan + Memoize em toda a cadeia, sem materializacao
--   -> Execution Time: 213 ms
--   -> o filtro produto='HM' volta a ser empurrado para dentro

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
    s.oferta_codigo AS sinal_oferta_codigo,
    ch.aguardando_pagamento_em,
    ch.aguardando_pagamento_em IS NOT NULL AS aguardando_pagamento,
    ch.responsavel_comercial_id,
    ch.responsavel_ativacao_id,
    rc.nome AS responsavel_comercial,
    ra.nome AS responsavel_ativacao,
    scat.papel AS sinal_papel,
    scat.entrada_do_programa AS sinal_entrada_do_programa,
    scat.valor_tabela AS sinal_valor_tabela,
    ent.valor_esperado AS entrada_valor_esperado,
    (rn.oferta_codigo IS NOT NULL) AS renovacao,
    rn.oferta_codigo AS renovacao_oferta_codigo,
    ch.ativ_gps
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
     LEFT JOIN LATERAL ( SELECT p.pago_em,
            p.valor,
            p.oferta_codigo
           FROM cs.hm_pagamentos p
             JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
          WHERE p.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
          ORDER BY p.pago_em DESC NULLS LAST, p.valor DESC, p.id DESC
         LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT c.status,
            COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true
     LEFT JOIN cs.usuarios rc ON rc.id = ch.responsavel_comercial_id
     LEFT JOIN cs.usuarios ra ON ra.id = ch.responsavel_ativacao_id
     LEFT JOIN hm_product_catalog scat ON scat.offer_code = s.oferta_codigo
     LEFT JOIN LATERAL ( SELECT min(cat.valor_tabela) AS valor_esperado
           FROM hm_product_catalog cat
          WHERE cat.entrada_do_programa = true
            AND cat.valor_tabela IS NOT NULL
            AND cs.fn_hm_pagamento_do_produto(cat.offer_code, ch.produto)
         ) ent ON true
     LEFT JOIN LATERAL ( SELECT p.oferta_codigo
           FROM cs.hm_pagamentos p
             JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
          WHERE p.comprador_id = ch.comprador_id AND cat.papel = 'renovacao'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
          ORDER BY p.pago_em DESC NULLS LAST, p.valor DESC, p.id DESC
         LIMIT 1) rn ON true;

comment on column cs.contatos_hm_kanban.sinal_papel is
  '0269: papel (catálogo, 0268) da oferta de sinal_oferta_codigo — "entrada" nas duas variantes do sinal HM (barata/cara), "renovacao" quando o sinal vigente é de renovação, NULL se a oferta ainda não foi classificada.';

comment on column cs.contatos_hm_kanban.sinal_entrada_do_programa is
  '0269: entrada_do_programa (catálogo) da oferta de sinal_oferta_codigo. Desambigua o sinal do HM do sinal do AURUM/downsell, que também têm categoria=sinal.';

comment on column cs.contatos_hm_kanban.sinal_valor_tabela is
  '0269: valor_tabela (catálogo, preço de vitrine — NÃO é régua de cobrança, ver 0255) da oferta de sinal_oferta_codigo.';

comment on column cs.contatos_hm_kanban.entrada_valor_esperado is
  '0269: MENOR valor_tabela entre as ofertas com entrada_do_programa=true do MESMO produto do contato (LATERAL ent, casamento por cs.fn_hm_pagamento_do_produto). Base para a rota comparar sinal_valor_tabela > entrada_valor_esperado sem faixa de preço hardcoded — no AURUM (uma só oferta de entrada) sinal_valor_tabela sempre = entrada_valor_esperado; no HM (duas ofertas, 300 e 697) o mínimo é 300 e só a de 697 fica acima.';

comment on column cs.contatos_hm_kanban.renovacao is
  '0269: TRUE = existe pagamento em cs.hm_pagamentos cuja oferta tem papel=renovacao (catálogo, 0268) e casa com o produto do contato (cs.fn_hm_pagamento_do_produto). LATERAL próprio — o LATERAL `s` do sinal só olha categoria=sinal e não alcança as renovações legadas (categoria=renovacao).';

comment on column cs.contatos_hm_kanban.renovacao_oferta_codigo is
  '0269: qual oferta de renovação (para tooltip). Mesmo critério de desempate do LATERAL `s`: pago_em desc, valor desc, id desc.';

comment on view cs.contatos_hm_kanban is
  '0300: ativ_gps na projecao (alias ch, ja no FROM), no fim para casar com a ordem existente. Reverte o envelope da 0297 — subselect que virava barreira de otimizacao e derrubou o board em 18/08.';
