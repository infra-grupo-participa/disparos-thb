-- =====================================================================
-- 0009_cs_jornada_ht_kanban
-- Estágios da jornada HT para o Kanban (página inicial). Modelo:
--   Comprou Ingresso → Em Onboarding → Dentro do Grupo → Ativado →
--   Evento em Andamento → Aplicou Holding Masters → Encaminhado ao Comercial → Fechado
-- Reaproveita 'ativado'; adiciona os demais; remapeia os contatos dos estágios
-- antigos; desativa os antigos (mantidos para histórico de interações).
-- Adiciona cs.contatos.tags (atribuição de tags no card).
-- =====================================================================
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final) values
  ('comprou_ingresso',  'Comprou Ingresso',         10, '#a855f7', true,  false),
  ('em_onboarding',     'Em Onboarding',            20, '#3b82f6', false, false),
  ('dentro_grupo',      'Dentro do Grupo',          30, '#06b6d4', false, false),
  ('evento_andamento',  'Evento em Andamento',      50, '#f59e0b', false, false),
  ('holding_masters',   'Aplicou Holding Masters',  60, '#10b981', false, false),
  ('comercial',         'Encaminhado ao Comercial', 70, '#6366f1', false, false),
  ('fechado',           'Fechado',                  80, '#64748b', false, true)
on conflict (chave) do update
  set nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
      is_inicial = excluded.is_inicial, is_final = excluded.is_final, ativo = true;

update cs.estagios set nome = 'Ativado', ordem = 40, cor = '#22c55e', is_inicial = false, is_final = false, ativo = true
 where chave = 'ativado';

update cs.contatos set estagio_id = (select id from cs.estagios where chave = 'comprou_ingresso')
 where estagio_id in (select id from cs.estagios where chave in ('novo'));
update cs.contatos set estagio_id = (select id from cs.estagios where chave = 'em_onboarding')
 where estagio_id in (select id from cs.estagios where chave in ('contatado','respondeu','em_acompanhamento'));
update cs.contatos set estagio_id = (select id from cs.estagios where chave = 'fechado')
 where estagio_id in (select id from cs.estagios where chave in ('sem_retorno'));

update cs.estagios set ativo = false, is_inicial = false, is_final = false
 where chave in ('novo','contatado','respondeu','em_acompanhamento','sem_retorno');

alter table cs.contatos add column if not exists tags text[] not null default '{}';
