-- =====================================================================
-- 0019_cs_camada_evento
-- Torna o workspace multi-evento. Marca cada registro de CS, disparo e estágio
-- com seu `evento` (default 'HT' — preserva todo o histórico existente). Cria a
-- jornada do Seminário (estágios 'SEM') e a view unificada cs.contatos_evento,
-- que as telas consultam filtrando por evento. O HT continua idêntico: a parte
-- 'HT' da view reproduz cs.contatos_ht.
-- =====================================================================
alter table cs.contatos  add column if not exists evento text not null default 'HT';
alter table cs.disparos  add column if not exists evento text not null default 'HT';
alter table cs.estagios  add column if not exists evento text not null default 'HT';

create index if not exists cs_contatos_evento_idx on cs.contatos (evento);

-- Jornada do Seminário (funil de leads de marketing → grupo → comercial).
-- Idempotente: só insere se ainda não existir a chave.
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento)
select v.chave, v.nome, v.ordem, v.cor, v.is_inicial, v.is_final, true, 'SEM'
from (values
  ('sem_lead',      'Leads',     10, '#94a3b8', true,  false),
  ('sem_mql',       'MQL',       20, '#3b82f6', false, false),
  ('sem_grupo',     'No grupo',  30, '#06b6d4', false, false),
  ('sem_comercial', 'Comercial', 40, '#6366f1', false, false),
  ('sem_fechado',   'Fechado',   50, '#64748b', false, true)
) as v(chave, nome, ordem, cor, is_inicial, is_final)
where not exists (select 1 from cs.estagios e where e.chave = v.chave);

-- View unificada: HT (compras) + SEM (leads manuais). Expõe TODAS as colunas
-- que as telas/detalhe consomem; o lado SEM puxa os campos de cs.contatos e
-- deixa nulos os específicos de compra do HT. O HT reproduz cs.contatos_ht.
drop view if exists cs.contatos_evento;
create view cs.contatos_evento as
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
   where ct.evento = 'SEM';

grant select on cs.contatos_evento to disparos_app;
