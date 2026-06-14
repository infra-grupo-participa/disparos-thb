-- =====================================================================
-- 0020_cs_templates_evento
-- Templates de disparo por evento (HT vs Seminário usam templates diferentes).
-- Default 'HT' preserva os templates existentes. A listagem (/api/templates) e
-- a criação passam a respeitar o evento do contexto (cookie cs_evento).
-- =====================================================================
alter table cs.templates add column if not exists evento text not null default 'HT';
