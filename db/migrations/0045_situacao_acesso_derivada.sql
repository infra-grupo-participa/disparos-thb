-- =====================================================================
-- 0045_situacao_acesso_derivada
-- A "situação de acesso" do aluno passa a ser DERIVADA de data_expiracao,
-- em vez de depender de alguém digitar.
--
-- Problema: `status_acesso` (o campo que o GPS e o painel 360 leem) só muda na
-- mão. Hoje 284 alunos estão como 'vigente' com a data de expiração no passado,
-- 241 estão sem situação e 107 estão em dia com o campo vazio. Já
-- `situacao_acesso` bate com a data em todos os casos menos dois — ele é
-- derivável, e é o que esta migration passa a calcular.
--
-- Regras (nesta ordem):
--   1. Sócio (eh_socio ou regra_acesso='Acompanha titular') → 'acompanha_titular'.
--      A validade é a do titular; status_acesso não é tocado.
--   2. Sem data_expiracao (48 alunos, fora sócios) → NÃO TOCA. Não há base para
--      afirmar nada; inventar aqui seria pior que o campo vazio.
--   3. Com data: vencido (< hoje) | a_vencer (até 30 dias) | em_dia.
--
-- status_acesso acompanha: 'gratuidade' é preservada, 'renovado' é preservado
-- enquanto válido, o resto vira 'vigente' ou o novo valor 'vencido'.
--
-- ATENÇÃO: esta tabela é domínio compartilhado (v1/v2 do sistema-grupo-participa
-- também escrevem nela). Esta migration adiciona 'vencido' ao check de
-- status_acesso — é aditivo, nenhum valor existente deixa de ser aceito.
-- Idempotente.
-- =====================================================================

-- 1) 'vencido' passa a ser um status_acesso válido -------------------------
alter table public.thb_alunos drop constraint if exists thb_alunos_status_acesso_check;
alter table public.thb_alunos
  add constraint thb_alunos_status_acesso_check
  check (status_acesso is null or status_acesso in ('vigente','renovado','gratuidade','vencido'));

-- 2) Recalcula a situação de todos os alunos. Retorna quantos mudaram. ------
create or replace function public.fn_recalcular_situacao_acesso()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_mudados integer;
begin
  with alvo as (
    select a.id,
           case
             when a.eh_socio or coalesce(a.regra_acesso,'') = 'Acompanha titular' then 'acompanha_titular'
             when a.data_expiracao is null                     then a.situacao_acesso  -- sem base: preserva
             when a.data_expiracao <  current_date             then 'vencido'
             when a.data_expiracao <= current_date + 30        then 'a_vencer'
             else 'em_dia'
           end as nova_situacao,
           case
             when a.status_acesso = 'gratuidade'               then 'gratuidade'
             when a.eh_socio or coalesce(a.regra_acesso,'') = 'Acompanha titular' then a.status_acesso
             when a.data_expiracao is null                     then a.status_acesso
             when a.data_expiracao <  current_date             then 'vencido'
             when a.status_acesso = 'renovado'                 then 'renovado'
             else 'vigente'
           end as novo_status
      from public.thb_alunos a
  )
  update public.thb_alunos a
     set situacao_acesso = alvo.nova_situacao,
         status_acesso   = alvo.novo_status,
         atualizado_em   = now()
    from alvo
   where a.id = alvo.id
     and (a.situacao_acesso is distinct from alvo.nova_situacao
       or a.status_acesso   is distinct from alvo.novo_status);

  get diagnostics v_mudados = row_count;

  if v_mudados > 0 then
    insert into public.thb_system_events (tipo, fonte, titulo, detalhe)
    values ('info', 'cron', 'Situação de acesso recalculada',
            jsonb_build_object('alunos_atualizados', v_mudados));
  end if;

  return v_mudados;
end$fn$;

-- 3) Roda todo dia às 06:10 UTC (03:10 em São Paulo) ------------------------
select cron.schedule('situacao-acesso-diaria', '10 6 * * *',
                     $$select public.fn_recalcular_situacao_acesso();$$)
 where not exists (select 1 from cron.job where jobname = 'situacao-acesso-diaria');
