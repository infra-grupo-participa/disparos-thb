-- =====================================================================
-- 0096_hm_gravacao_reuniao
--
-- A GRAVAÇÃO DA REUNIÃO ENTRA NA FICHA (C1). O time já tem as gravações (Meet/
-- Zoom); faltava onde colar o link, do lado da marcação, para o relatório e para
-- quem for retomar o contato. A ANOTAÇÃO da reunião já existe — é
-- reuniao_resultado / entrevista_resultado; aqui só entra o link.
--
-- Dois campos, espelhando os pares que já existem (reuniao_* / entrevista_*):
-- reunião é a conversa do Comercial; entrevista é a da Ativação.
--
-- A view expõe os dois no FIM (create or replace não reordena). Idempotente.
-- =====================================================================

alter table cs.contatos_hm add column if not exists reuniao_gravacao_url    text;
alter table cs.contatos_hm add column if not exists entrevista_gravacao_url text;

comment on column cs.contatos_hm.reuniao_gravacao_url is
  'Link da gravação da reunião (Comercial). O time já tem a gravação; aqui mora o endereço dela.';
comment on column cs.contatos_hm.entrevista_gravacao_url is
  'Link da gravação da entrevista (Ativação).';

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
    hs.status AS hotmart_status,
    hs.em AS hotmart_status_em,
    COALESCE(
      ( SELECT t FROM unnest(ch.tags) t WHERE t ~ '^HT[0-9]+$' LIMIT 1),
      ( SELECT t FROM unnest(ch.tags) t
         WHERE t = ANY (ARRAY['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta'])
         ORDER BY array_position(ARRAY['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta'], t)
         LIMIT 1)
    ) AS canal_aquisicao,
    -- ----- novo (0096): as gravações -----
    ch.reuniao_gravacao_url,
    ch.entrevista_gravacao_url
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
     LEFT JOIN LATERAL ( SELECT c.status AS status, COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM public.compras c
             JOIN public.hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true;

-- O "desfazer edição" (0095) passa a cobrir também os links de gravação.
create or replace function cs.fn_hm_undo_colunas()
returns text[] language sql immutable as $fn$
  select array[
    'responsavel','turma','turma_origem','plano','observacoes',
    'reuniao_resultado','entrevista_resultado','reuniao_gravacao_url','entrevista_gravacao_url',
    'pagamento_meio','pagamento_previsto_em','acordo','oferta_saldo_codigo','link_saldo_enviado_em',
    'nao_contatar','nao_contatar_motivo','revisar','revisar_motivo',
    'ativ_searchie','ativ_comunidade','ativ_grupo','ativ_pesquisa','grupo_informes','pendencia',
    'cancelamento_motivo','link_facebook',
    'rev_searchie','rev_comunidade','rev_grupo','rev_pesquisa',
    'credito_oferta','credito_valor_pago','credito_dias_totais','credito_compra_em',
    'valor_total','valor_pago','pagamento_em','cancelamento_em','tags'
  ]::text[];
$fn$;
