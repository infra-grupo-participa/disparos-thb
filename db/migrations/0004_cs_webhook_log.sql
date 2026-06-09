-- =====================================================================
-- 0004_cs_webhook_log
-- Observabilidade do caminho de resposta (SLA): registra TODA chamada
-- recebida em /api/webhook, com telefone bruto/normalizado, resultado do
-- casamento e payload. Permite diagnosticar se a Unnichat está chamando o
-- webhook e em que formato o telefone chega.
-- Aplicada em produção via admin (Supabase). Mantida aqui para versionamento.
-- =====================================================================
create table if not exists cs.webhook_log (
  id            bigserial primary key,
  recebido_em   timestamptz not null default now(),
  origem        text,          -- ip (x-forwarded-for) ou user-agent
  telefone_raw  text,          -- telefone como veio no payload
  telefone_norm text,          -- telefone normalizado (55DDD...)
  resultado     text,          -- invalid_secret | sem_telefone | matched | duplicado | registrado_sem_disparo | telefone_nao_encontrado
  payload       jsonb
);
create index if not exists cs_webhook_log_recebido_idx on cs.webhook_log (recebido_em desc);

grant insert, select on cs.webhook_log to disparos_app;
grant usage, select on sequence cs.webhook_log_id_seq to disparos_app;
