-- =====================================================================
-- 0115_reembolso_revoga_trilha
--
-- Buraco da Fase 3: a trilha nascia no sinal aprovado e NUNCA morria. Reembolso,
-- chargeback ou protesto do sinal deixavam o acesso ao GPS de pé. Foi visto na
-- 0114, que limpou por acidente Jorge Amancio (REFUNDED) e Luiz Carlos (PROTESTED).
-- Aqui isso vira regra: sem sinal válido, sem trilha.
--
-- Só apaga linha que ESTE funil criou (fonte sip_sinal_trilha) e só quando não
-- resta nenhum sinal aprovado que conceda. Aluno de verdade nunca é tocado.
-- Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_revogar_trilha(p_comprador_id uuid)
returns boolean
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare v_apagou boolean := false;
begin
  delete from public.thb_alunos a
   where a.comprador_id = p_comprador_id
     and a.fonte = 'sip_sinal_trilha'
     and not exists (
       select 1 from public.compras c
         join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
        where c.comprador_id = p_comprador_id
          and c.status in ('APPROVED','COMPLETE','COMPLETED')
          and cat.categoria = 'sinal'
          and cat.concede_trilha
     );
  get diagnostics v_apagou = row_count;
  return v_apagou;
end$fn$;

grant execute on function cs.fn_hm_revogar_trilha(uuid) to disparos_app;

comment on function cs.fn_hm_revogar_trilha(uuid) is
  'Sem sinal aprovado que conceda, a trilha do GPS cai. So apaga linha criada por este funil (sip_sinal_trilha).';

create or replace function cs.fn_hm_trilha_cancelada()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
begin
  if new.comprador_id is null then return new; end if;
  begin
    perform cs.fn_hm_revogar_trilha(new.comprador_id);
  exception when others then
    raise warning 'revogacao de trilha falhou para comprador %: %', new.comprador_id, sqlerrm;
  end;
  return new;
end$fn$;

drop trigger if exists trg_zz_hm_trilha_cancelada on public.compras;
create trigger trg_zz_hm_trilha_cancelada
  after update of status on public.compras
  for each row
  when (new.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
  execute function cs.fn_hm_trilha_cancelada();
