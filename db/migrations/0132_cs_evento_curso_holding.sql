-- =====================================================================
-- 0132_cs_evento_curso_holding
-- Novo portal (evento 'CNHF'): Curso Nacional de Formação em Holding Familiar.
-- Segue o molde genérico do Seminário — reusa as telas de app/[portal]/* e a
-- view unificada cs.contatos_evento. Aqui só nasce a "camada de contexto":
-- o registro do evento, a jornada (estágios) e o recorte do Curso na view.
-- Sem canal de disparo e sem templates: entram quando houver número e campanha.
-- Aditivo e idempotente — não toca HT/SEM/HM.
-- =====================================================================

-- 1) O evento. 'CNHF' = Curso Nacional de Formação em Holding Familiar. Violeta, para se distinguir
-- do laranja (HT), do azul (SEM) e do âmbar (HM) no seletor de portais.
insert into cs.eventos (chave, nome, cor, ordem) values
  ('CNHF', 'Curso de Holding', '#7C3AED', 3)
on conflict (chave) do nothing;

-- 2) Jornada do Curso (lead de marketing → grupo → comercial → matrícula).
-- Mesmo formato do funil do Seminário (0019), com o desfecho renomeado para
-- "Matriculado". Idempotente: só insere a chave que ainda não existir.
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento)
select v.chave, v.nome, v.ordem, v.cor, v.is_inicial, v.is_final, true, 'CNHF'
from (values
  ('cnhf_lead',       'Leads',       10, '#94a3b8', true,  false),
  ('cnhf_mql',        'MQL',         20, '#a78bfa', false, false),
  ('cnhf_grupo',      'No grupo',    30, '#8b5cf6', false, false),
  ('cnhf_comercial',  'Comercial',   40, '#7c3aed', false, false),
  ('cnhf_matriculado','Matriculado', 50, '#6d28d9', false, true)
) as v(chave, nome, ordem, cor, is_inicial, is_final)
where not exists (select 1 from cs.estagios e where e.chave = v.chave);

-- 3) A view unificada ganha o recorte do Curso. Reproduz HT + SEM (idênticos à
-- 0019) e acrescenta o bloco 'CNHF' — cópia do bloco do Seminário, pois a jornada
-- do Curso também é de leads manuais em cs.contatos cruzados com public.compradores.
-- Usa CREATE OR REPLACE (mesma assinatura de colunas) para preservar as views que
-- dependem desta (ex.: 0071); um DROP CASCADE as derrubaria.
create or replace view cs.contatos_evento as
  select 'HT'::text as evento, h.comprador_id, h.nome, h.email, h.telefone,
         h.ultima_compra_ht, h.ultimo_produto, h.edition_number, h.edicao,
         h.estagio_id, h.estagio_chave, h.estagio_nome, h.responsavel,
         h.proxima_acao_em, h.proxima_acao_nota, h.ultimo_contato_em, h.ultima_resposta_em,
         h.observacoes, h.edicao_ht, h.primeiro_contato_em,
         h.legado_ativado, h.legado_ativacao_em, h.legado_sla_h, h.legado_no_grupo,
         h.legado_pesquisa, h.legado_ja_ht, h.legado_qtd_ht, h.legado_ja_hm,
         h.legado_e_aluno, h.legado_instrucao, h.legado_t_primeiro_contato_h, h.legado_t_ativacao_h
    from cs.contatos_ht h
  union all
  select 'SEM'::text as evento, cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
         null::timestamptz as ultima_compra_ht, null::varchar as ultimo_produto,
         null::integer as edition_number, coalesce(ct.edicao_ht, 'SEM')::text as edicao,
         ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, ct.responsavel,
         ct.proxima_acao_em, ct.proxima_acao_nota, ct.ultimo_contato_em, ct.ultima_resposta_em,
         ct.observacoes, ct.edicao_ht, ct.primeiro_contato_em,
         ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h, ct.legado_no_grupo,
         ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht, ct.legado_ja_hm,
         ct.legado_e_aluno, ct.legado_instrucao, ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h
    from cs.contatos ct
    join public.compradores cmp on cmp.id = ct.comprador_id
    left join cs.estagios est on est.id = ct.estagio_id
   where ct.evento = 'SEM'
  union all
  select 'CNHF'::text as evento, cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
         null::timestamptz as ultima_compra_ht, null::varchar as ultimo_produto,
         null::integer as edition_number, coalesce(ct.edicao_ht, 'CNHF')::text as edicao,
         ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, ct.responsavel,
         ct.proxima_acao_em, ct.proxima_acao_nota, ct.ultimo_contato_em, ct.ultima_resposta_em,
         ct.observacoes, ct.edicao_ht, ct.primeiro_contato_em,
         ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h, ct.legado_no_grupo,
         ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht, ct.legado_ja_hm,
         ct.legado_e_aluno, ct.legado_instrucao, ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h
    from cs.contatos ct
    join public.compradores cmp on cmp.id = ct.comprador_id
    left join cs.estagios est on est.id = ct.estagio_id
   where ct.evento = 'CNHF';

grant select on cs.contatos_evento to disparos_app;
