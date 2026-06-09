-- =====================================================================
-- 0006_cs_disparo_status_entrega
-- Status de entrega real (sent/delivered/read/failed) das mensagens do disparo.
-- A Meta reporta o status de forma assíncrona; consultamos via Unnichat
-- (GET /meta/messages/{id} → data.status). O erro 130472 = "User's number is
-- part of an experiment" (Meta bloqueia template de marketing; não é falha nossa).
-- Aplicada em produção via admin (Supabase). Mantida aqui para versionamento.
-- =====================================================================
alter table cs.disparo_contatos
  add column if not exists unnichat_contact_id text,   -- id do contato na Unnichat (POST /contact)
  add column if not exists unnichat_message_id text,   -- id da mensagem template (consulta de status)
  add column if not exists status_meta text,           -- sent | delivered | read | failed
  add column if not exists status_em timestamptz,
  add column if not exists erro_meta_code int;          -- ex.: 130472 = experiment
