-- 0182 — o kanban expõe o marcador de boleto não pago (complementa a 0181).
--
-- ⚠️ APLICADA EM PRODUÇÃO em 11/08/2026
-- (supabase_migrations: 0182_kanban_expoe_aguardando_pagamento).
-- Definição extraída de produção com pg_get_viewdef — é a view REAL.
--
-- Sem isto, cs.contatos_hm.aguardando_pagamento_em existe mas nem a UI nem os exports
-- enxergam: o card apareceria na coluna "Aguardando Pagamento" sem indicador de que
-- o dinheiro não entrou.
--
-- Acrescenta, SÓ NO FIM:
--   · aguardando_pagamento_em  timestamptz
--   · aguardando_pagamento     boolean (= aguardando_pagamento_em IS NOT NULL)
--
-- ⚠️ Coluna nova sempre no FIM: create or replace view não reordena, e
-- public.vw_aluno_360 depende desta view (drop cascade derrubaria a base do GPS).
-- ⚠️ sinal_valor tem cast para numeric(10,2): compras.preco é numeric(10,2) e
-- hm_pagamentos.valor é numeric(12,2), e não se pode trocar tipo de coluna existente.

begin;

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
    ch.aguardando_pagamento_em IS NOT NULL AS aguardando_pagamento
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
         LIMIT 1) hs ON true;

comment on column cs.contatos_hm_kanban.aguardando_pagamento is
  '0182: TRUE = boleto/PIX gerado e ainda não compensado. O card existe mas o dinheiro NÃO entrou — não conte como venda.';

commit;
