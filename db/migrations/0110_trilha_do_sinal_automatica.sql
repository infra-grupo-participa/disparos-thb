-- =====================================================================
-- 0110_trilha_do_sinal_automatica
--
-- Fecha a Fase 3: daqui pra frente, quando um SINAL é aprovado, a linha de trilha
-- nasce sozinha — sem depender de alguém lembrar. A 0109 fez o backfill dos que já
-- existiam; este gatilho cuida dos próximos.
--
-- Gatilho NOVO e aditivo: não altera nenhum trigger existente (seed do card, razão,
-- cancelamento seguem intocados). Roda por último (nome com 'zz') para o razão já
-- ter lançado. Não-fatal: se o provisionamento falhar, a compra entra assim mesmo
-- — um erro aqui nunca pode derrubar a ingestão de pagamento.
--
-- Toda a segurança vive em cs.fn_hm_provisionar_trilha_sinal (0109): só sinal, só
-- quem NÃO quitou, e só linha nova — nunca toca em cadastro existente.
-- Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_trilha_do_sinal()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_cat text;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then return new; end if;
  if new.comprador_id is null then return new; end if;

  select cat.categoria into v_cat
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if v_cat is distinct from 'sinal' then return new; end if;

  begin
    perform cs.fn_hm_provisionar_trilha_sinal(new.comprador_id);
  exception when others then
    -- Nunca derruba a ingestão do pagamento por causa do provisionamento.
    raise warning 'trilha do sinal falhou para comprador %: %', new.comprador_id, sqlerrm;
  end;

  return new;
end$fn$;

drop trigger if exists trg_zz_hm_trilha_sinal on public.compras;
create trigger trg_zz_hm_trilha_sinal
  after insert or update of status on public.compras
  for each row
  execute function cs.fn_hm_trilha_do_sinal();

comment on function cs.fn_hm_trilha_do_sinal() is
  'Sinal aprovado -> provisiona a linha de trilha (acesso ao GPS). Aditivo e nao-fatal; toda a trava esta em fn_hm_provisionar_trilha_sinal.';
