-- =====================================================================
-- 0068_hm_sinal_na_view
-- A visão financeira precisa da entrada: quando o sinal foi pago, e quanto.
--
-- A tabela/relatório mostram a história financeira do aluno (sinal → saldo →
-- cancelamento), mas o card não guarda a data nem o valor do sinal — esses
-- fatos vivem em public.compras. A data de criação do card NÃO serve de
-- aproximação: os 129 cards importados da planilha nasceram no dia da
-- importação, e a "data do sinal" deles mentiria em massa.
--
-- Expostos aqui, na view (que roda como owner e enxerga compras):
--   sinal_pago_em → a data da VENDA do sinal que abriu o card (a mesma régua
--                   do canal, 0063: a aprovação é detalhe do meio de pagamento)
--   sinal_valor   → o preço daquela compra (R$300, R$2.000 da Imersão…)
-- Compra cheia (sem sinal) e acordo fora da Hotmart ficam null — "—" honesto.
--
-- `create or replace` (NUNCA drop): public.vw_aluno_360 depende desta view.
-- Colunas antigas intactas e na mesma posição; as novas entram NO FIM.
-- Idempotente.
-- =====================================================================

create or replace view cs.contatos_hm_kanban with (security_invoker = false) as
 select ch.id as contato_hm_id,
    ch.comprador_id,
    cmp.nome,
    cmp.email,
    cmp.telefone,
    ch.turma,
    ch.plano,
    ch.categoria_entrada,
    ch.estagio_id,
    est.chave as estagio_chave,
    est.nome as estagio_nome,
    est.aba as estagio_aba,
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
    -- novos (0068): o sinal que abriu o card
    s.pago_em as sinal_pago_em,
    s.valor as sinal_valor
   from cs.contatos_hm ch
     join public.compradores cmp on cmp.id = ch.comprador_id
     left join cs.estagios est on est.id = ch.estagio_id
     left join lateral (
       select coalesce(c.data_compra, c.data_aprovacao) as pago_em, c.preco as valor
         from public.compras c
         join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
        where c.comprador_id = ch.comprador_id
          and cat.categoria = 'sinal'
          and c.status in ('APPROVED','COMPLETE','COMPLETED')
        order by coalesce(c.data_compra, c.data_aprovacao)
        limit 1
     ) s on true;

grant select on cs.contatos_hm_kanban to disparos_app;
