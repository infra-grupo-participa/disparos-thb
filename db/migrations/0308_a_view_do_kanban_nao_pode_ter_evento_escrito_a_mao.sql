-- 0308_a_view_do_kanban_nao_pode_ter_evento_escrito_a_mao
--
-- ── O sintoma (Victor, 26/08) ───────────────────────────────────────────────
-- O board do Acelera dizia "1 lead(s)" no cabeçalho e, abaixo, "Ninguém nesta
-- etapa" com "+ 1 além dos 0 mostrados". O contador via o card; a lista não.
--
-- ── A causa ─────────────────────────────────────────────────────────────────
-- /api/kanban usa DUAS fontes para a MESMA pergunta: o total sai de cs.contatos
-- (a tabela) e os cards saem de cs.contatos_evento (a view). A view tinha os
-- eventos ESCRITOS À MÃO — um braço 'SEM' e outro 'CNHF', idênticos fora o nome
-- do evento. Sem braço para o evento novo, a tabela devolvia 1 e a view, 0.
--
-- Não é um caso do Acelera: QUALQUER portal novo nasceria com o mesmo defeito, e
-- com a mesma cara de "quase funciona" — o pior modo de falhar, porque o número
-- no topo garante que o dado existe.
--
-- ── A correção ──────────────────────────────────────────────────────────────
-- Os dois braços viram UM, genérico. Duas trocas, e as DUAS importam:
--   · no WHERE:    evento = 'SEM'         →  evento <> 'HT'
--   · na projeção: 'SEM'::text AS evento  →  ct.evento
-- A segunda quase passou batido: o evento era um LITERAL no SELECT, então
-- generalizar só o WHERE fez a view carimbar 'SEM' em TODA linha — os 24.329
-- contatos do CNHF passaram a se dizer Seminário. Só a conferência evento a
-- evento pegou; um `count(*)` total teria dado igual e passado limpo.
--
-- ⚠️ O 'SEM' de `COALESCE(ct.edicao_ht, 'SEM')` NÃO é o evento — é a EDIÇÃO
-- padrão de quem não tem edição do HT. Fica como está.
--
-- HT fica fora do braço genérico porque tem braço próprio (cs.contatos_ht):
-- incluí-lo duplicaria os 782 contatos que também existem em cs.contatos com
-- evento='HT'.

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
    h.equipe_tipo
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
    eq.tipo AS equipe_tipo
   FROM cs.contatos ct
     JOIN compradores cmp ON cmp.id = ct.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ct.estagio_id
     LEFT JOIN cs.usuarios ru ON ru.id = ct.responsavel_id
     LEFT JOIN cs.equipes eq ON eq.id = ru.equipe_id
  WHERE ct.evento <> 'HT'::text;
