-- =====================================================================
-- 0013_cs_formularios
-- Respostas dos formulários (Matrícula, Ficha de Interesse HM) associadas ao
-- aluno. 1 linha por (comprador, tipo): responder de novo atualiza (upsert).
-- Alimentada pelo /api/eventos (push do Make lendo as abas da planilha).
-- =====================================================================
create table if not exists cs.formularios (
  id            uuid primary key default gen_random_uuid(),
  comprador_id  uuid not null,
  tipo          text not null check (tipo in ('matricula','ficha_hm')),
  respostas     jsonb not null default '{}'::jsonb,
  pontuacao     numeric,
  respondido_em timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (comprador_id, tipo)
);
grant select, insert, update, delete on cs.formularios to disparos_app;
alter table cs.formularios enable row level security;
drop policy if exists app_all on cs.formularios;
create policy app_all on cs.formularios to disparos_app using (true) with check (true);
create index if not exists ix_formularios_comprador on cs.formularios (comprador_id);
