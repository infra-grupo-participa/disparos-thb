-- 0310_a_view_carrega_os_campos_do_acelera
--
-- Os campos criados na 0309 (nível, origem, pré-checkout, compra) e a profissão
-- do comprador precisam chegar ao BOARD, e o board lê cs.contatos_evento — não a
-- tabela. Sem passar por aqui, o dado existe no banco e não aparece no card:
-- exatamente o modo de falhar da 0308.
--
-- ⚠️ As colunas entram no FIM da projeção, não perto das parecidas. Não é
-- estilo: `create or replace view` recusa mudança de ordem ou de posição das
-- colunas existentes — só aceita acréscimo no fim. Tentar agrupá-las junto do
-- comprador_id devolve 400.
--
-- O braço do HT recebe os mesmos campos como NULL: um UNION ALL exige as duas
-- pernas com a mesma assinatura, e deixar explícito que o HT não tem esses
-- campos é melhor do que descobrir por erro de tipo no deploy.

create or replace view cs.contatos_evento as
 SELECT 'HT'::text AS evento,
    h.comprador_id,
    h.nome,
    h.email,
    h.telefone,
    h.ultima_compra_ht,
    h.ultimo_produto,
    h.edition_number,
    h.edicao,
    h.estagio_id,
    h.estagio_chave,
    h.estagio_nome,
    h.responsavel,
    h.proxima_acao_em,
    h.proxima_acao_nota,
    h.ultimo_contato_em,
    h.ultima_resposta_em,
    h.observacoes,
    h.edicao_ht,
    h.primeiro_contato_em,
    h.legado_ativado,
    h.legado_ativacao_em,
    h.legado_sla_h,
    h.legado_no_grupo,
    h.legado_pesquisa,
    h.legado_ja_ht,
    h.legado_qtd_ht,
    h.legado_ja_hm,
    h.legado_e_aluno,
    h.legado_instrucao,
    h.legado_t_primeiro_contato_h,
    h.legado_t_ativacao_h,
    h.responsavel_id,
    h.equipe_id,
    h.equipe_nome,
    h.equipe_cor,
    h.equipe_tipo,
    NULL::text AS nivel_lead,
    NULL::text AS origem_lead,
    NULL::timestamp with time zone AS precheckout_em,
    NULL::timestamp with time zone AS comprou_em,
    NULL::text AS profissao
   FROM cs.contatos_ht h
UNION ALL
 SELECT ct.evento,
    cmp.id AS comprador_id,
    cmp.nome,
    cmp.email,
    cmp.telefone,
    NULL::timestamp with time zone AS ultima_compra_ht,
    NULL::character varying AS ultimo_produto,
    NULL::integer AS edition_number,
    COALESCE(ct.edicao_ht, 'SEM'::text) AS edicao,
    ct.estagio_id,
    est.chave AS estagio_chave,
    est.nome AS estagio_nome,
    ct.responsavel,
    ct.proxima_acao_em,
    ct.proxima_acao_nota,
    ct.ultimo_contato_em,
    ct.ultima_resposta_em,
    ct.observacoes,
    ct.edicao_ht,
    ct.primeiro_contato_em,
    ct.legado_ativado,
    ct.legado_ativacao_em,
    ct.legado_sla_h,
    ct.legado_no_grupo,
    ct.legado_pesquisa,
    ct.legado_ja_ht,
    ct.legado_qtd_ht,
    ct.legado_ja_hm,
    ct.legado_e_aluno,
    ct.legado_instrucao,
    ct.legado_t_primeiro_contato_h,
    ct.legado_t_ativacao_h,
    ct.responsavel_id,
    ru.equipe_id,
    eq.nome AS equipe_nome,
    eq.cor AS equipe_cor,
    eq.tipo AS equipe_tipo,
    ct.nivel_lead,
    ct.origem_lead,
    ct.precheckout_em,
    ct.comprou_em,
    cmp.profissao
   FROM cs.contatos ct
     JOIN compradores cmp ON cmp.id = ct.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ct.estagio_id
     LEFT JOIN cs.usuarios ru ON ru.id = ct.responsavel_id
     LEFT JOIN cs.equipes eq ON eq.id = ru.equipe_id
  WHERE ct.evento <> 'HT'::text;
