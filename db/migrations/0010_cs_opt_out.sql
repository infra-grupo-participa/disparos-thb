-- =====================================================================
-- 0010_cs_opt_out
-- Opt-out (LGPD / política do WhatsApp): quem pede para parar não recebe mais
-- disparos. Marcado automaticamente pelo webhook (PARAR/SAIR/...) ou manualmente.
-- O bloqueio é aplicado na seleção de envio (app/api/send).
-- =====================================================================
alter table cs.contatos add column if not exists opt_out boolean not null default false;
alter table cs.contatos add column if not exists opt_out_em timestamptz;
create index if not exists cs_contatos_opt_out_idx on cs.contatos (opt_out) where opt_out;
