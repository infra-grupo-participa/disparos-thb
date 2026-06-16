-- =====================================================================
-- 0025_cs_ligacoes_iniciada_em
-- Horário REAL da chamada (started_at do Atende Simples), separado do criado_em
-- (momento em que o webhook processou). As métricas por hora/dia devem usar o
-- horário real — senão rajadas do discador distorcem o "melhor horário".
-- Chamadas antigas (sem started_at gravado) caem no criado_em via coalesce.
-- =====================================================================
alter table cs.ligacoes add column if not exists iniciada_em timestamptz;

create index if not exists ix_ligacoes_iniciada on cs.ligacoes (iniciada_em);
