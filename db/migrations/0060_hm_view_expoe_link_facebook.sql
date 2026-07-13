-- =====================================================================
-- 0060_hm_view_expoe_link_facebook
-- Conserta a ficha do aluno no kanban HM (500 ao abrir o card).
--
-- A 0057 criou cs.contatos_hm.link_facebook (a aba de sócios pede o perfil do
-- aluno) e a rota GET /api/hm/contato/[id] passou a lê-lo — mas a view do kanban,
-- que é de onde a ficha lê, nunca foi recriada com a coluna. Resultado:
-- "column link_facebook does not exist" a cada abertura de card, 500 na API e o
-- drawer morrendo no JSON vazio.
--
-- `create or replace` (NUNCA drop): public.vw_aluno_360 — a base que o GPS
-- consome — depende desta view; um DROP ... CASCADE a derrubaria junto. O replace
-- exige as colunas antigas intactas e na mesma posição, então a nova entra no fim.
--
-- Aditiva e idempotente.
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
    -- a coluna que faltava (0057)
    ch.link_facebook
   from cs.contatos_hm ch
     join public.compradores cmp on cmp.id = ch.comprador_id
     left join cs.estagios est on est.id = ch.estagio_id;

grant select on cs.contatos_hm_kanban to disparos_app;
