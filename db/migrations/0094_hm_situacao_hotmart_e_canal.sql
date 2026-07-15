-- =====================================================================
-- 0094_hm_situacao_hotmart_e_canal
--
-- DOIS FATOS QUE A ESTEIRA NÃO EXPUNHA, materializados na view que TODA tela lê
-- (tabela, ficha e os dois XLSX saem de cs.contatos_hm_kanban). Colocar aqui é a
-- garantia de que ninguém diverge: uma definição, muitos leitores.
--
-- 1) SITUAÇÃO NA HOTMART (B2). A `situacao` que já existe é a NOSSA leitura
--    (quitado/saldo_parado/…). Falta o FATO: o status da compra HM na Hotmart
--    (APPROVED, REFUNDED, PROTESTED, EXPIRED…). É o status da compra HM mais
--    recente — a que está no catálogo do HM, nunca o ingresso do HT. O app não
--    lê public.compras (RLS); a view lê pelo dono, então é aqui que o fato passa.
--
-- 2) CANAL DE AQUISIÇÃO (B1). O canal já é TAG gerenciada por cs.fn_tag_hm_origem
--    ("pelo fato", 0052/0061). Em vez de reimplementar a regra no app (e arriscar
--    duas contas diferentes), a view extrai o canal das tags: edição do HT
--    (HT27/HT28…) primeiro, senão o evento/origem. Público (Aluno THB/Lead novo)
--    e turma (Turma T##) NÃO são canal e ficam de fora.
--
-- create or replace view não reordena nem remove coluna: as três novas entram no
-- FIM. Idempotente.
-- =====================================================================

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
    s.valor AS sinal_valor,
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
    -- ----- novo (0094): o fato da Hotmart e o canal -----
    hs.status AS hotmart_status,
    hs.em AS hotmart_status_em,
    COALESCE(
      ( SELECT t FROM unnest(ch.tags) t WHERE t ~ '^HT[0-9]+$' LIMIT 1),
      ( SELECT t FROM unnest(ch.tags) t
         WHERE t = ANY (ARRAY['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta'])
         ORDER BY array_position(ARRAY['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta'], t)
         LIMIT 1)
    ) AS canal_aquisicao
   FROM cs.contatos_hm ch
     JOIN public.compradores cmp ON cmp.id = ch.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ch.estagio_id
     LEFT JOIN LATERAL ( SELECT COALESCE(c.data_compra, c.data_aprovacao) AS pago_em,
            c.preco AS valor
           FROM public.compras c
             JOIN public.hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND (c.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text, 'COMPLETED'::text]))
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao))
         LIMIT 1) s ON true
     -- A compra HM mais recente (qualquer status): é ela que diz o fato na Hotmart.
     LEFT JOIN LATERAL ( SELECT c.status AS status, COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM public.compras c
             JOIN public.hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true;
