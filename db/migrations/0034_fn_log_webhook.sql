-- =====================================================================
-- 0034_fn_log_webhook
-- Diagnóstico: grava o payload cru de webhooks (ex.: Sendflow) em cs.webhook_log
-- para ajustar o mapeamento de campos. Usada via service_role pelas Edge Functions
-- (o schema cs não é exposto no PostgREST, por isso a RPC em public).
-- =====================================================================
create or replace function public.fn_log_webhook(p_origem text, p_resultado text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, cs
as $fn$
begin
  insert into cs.webhook_log (origem, resultado, payload) values (p_origem, p_resultado, p_payload);
end$fn$;

revoke all on function public.fn_log_webhook(text, text, jsonb) from public;
grant execute on function public.fn_log_webhook(text, text, jsonb) to service_role;
