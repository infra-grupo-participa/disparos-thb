-- 0323_o_aviso_do_slack_sai_uma_vez_por_fato
--
-- NÃO APLICADA. Escrita junto com a mudança da Edge Function hotmart-events-webhook
-- (decidir_aviso.ts). Aplicar ANTES do deploy da function: sem a função pública
-- abaixo, o .rpc("fn_reivindicar_aviso_slack") erra e a function cai na falha aberta
-- (publica sem deduplicar) — funciona, mas continua duplicando.
--
-- ── O sintoma ────────────────────────────────────────────────────────────────
-- A Hotmart manda CADA evento 2 vezes, com 0,4 a 2,5 s de diferença (conferido em
-- cs.hotmart_eventos). O card do Slack saía em dobro. Parcelas 2, 3… saíam como
-- "Nova compra"; cada tentativa de cartão recusada virava "Compra cancelada".
--
-- ── O que muda ───────────────────────────────────────────────────────────────
-- cs.slack_notificacao_compra já existia (PK hotmart_transaction) com
-- cs.fn_reivindicar_notificacao_slack, sem ninguém chamando desde 27/07 e sem FK
-- apontando para ela. Passa a guardar um aviso por (chave, tipo):
--   · a coluna hotmart_transaction guarda a CHAVE do aviso (transação, ou
--     "RECUSA|<sha256 do e-mail>|<produto>|<dia>", ou "<evento>|<transação>") — nome mantido
--     para não quebrar a função antiga;
--   · tipo ∈ VENDA | AGUARDANDO | RECUSA | CANCELAMENTO (default VENDA, que é o
--     que as linhas existentes eram);
--   · PK (hotmart_transaction, tipo): PIX gerado e PIX pago da mesma transação são
--     dois avisos, cada um uma vez.
-- A reivindicação é um INSERT ... ON CONFLICT DO NOTHING RETURNING pela PK: atômica,
-- o 2º envio concorrente recebe false. É a ÚNICA query nova no caminho quente.
--
-- ── Por que um wrapper em public ─────────────────────────────────────────────
-- O schema cs não é exposto no PostgREST (ver 0294). O .rpc() da Edge Function só
-- enxerga public. A lógica fica em cs; public tem uma casca fina com o mesmo revoke.

begin;

do $$
begin
  if to_regclass('cs.slack_notificacao_compra') is null then
    raise exception '0323: cs.slack_notificacao_compra não existe — esta migration supõe a tabela viva.';
  end if;
end $$;

alter table cs.slack_notificacao_compra
  add column if not exists tipo text not null default 'VENDA';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'cs.slack_notificacao_compra'::regclass
       and conname = 'slack_notificacao_compra_tipo_check'
  ) then
    alter table cs.slack_notificacao_compra
      add constraint slack_notificacao_compra_tipo_check
      check (tipo in ('VENDA', 'AGUARDANDO', 'RECUSA', 'CANCELAMENTO'));
  end if;
end $$;

-- Troca a PK pelo nome real (lido do catálogo, não de memória).
do $$
declare v_pk text; v_cols text;
begin
  select c.conname, pg_catalog.pg_get_constraintdef(c.oid)
    into v_pk, v_cols
    from pg_catalog.pg_constraint c
   where c.conrelid = 'cs.slack_notificacao_compra'::regclass and c.contype = 'p';

  if v_cols = 'PRIMARY KEY (hotmart_transaction, tipo)' then
    raise notice '0323: PK já é (hotmart_transaction, tipo) — nada a trocar.';
    return;
  end if;

  if v_pk is not null then
    execute pg_catalog.format('alter table cs.slack_notificacao_compra drop constraint %I', v_pk);
  end if;
  alter table cs.slack_notificacao_compra
    add constraint slack_notificacao_compra_pkey primary key (hotmart_transaction, tipo);
end $$;

-- ── A reivindicação ──────────────────────────────────────────────────────────
-- VOLATILE (default): grava. Devolve true só para quem inseriu a linha.
create or replace function cs.fn_reivindicar_aviso_slack(p_chave text, p_tipo text, p_canal text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_ok boolean;
begin
  if p_chave is null or pg_catalog.btrim(p_chave) = '' then
    raise exception 'fn_reivindicar_aviso_slack: chave vazia';
  end if;

  insert into cs.slack_notificacao_compra (hotmart_transaction, tipo, canal, notificado_em)
  values (p_chave, p_tipo, p_canal, pg_catalog.now())
  on conflict (hotmart_transaction, tipo) do nothing
  returning true into v_ok;

  return coalesce(v_ok, false);
end
$fn$;

comment on function cs.fn_reivindicar_aviso_slack(text, text, text) is
  '0323: reivindica um aviso do Slack do webhook da Hotmart. true = este chamador publica; false = alguém já publicou (a Hotmart manda cada evento 2x). Chave e tipo vêm de decidirAviso (supabase/functions/hotmart-events-webhook/decidir_aviso.ts).';

revoke execute on function cs.fn_reivindicar_aviso_slack(text, text, text) from public, anon, authenticated;
grant execute on function cs.fn_reivindicar_aviso_slack(text, text, text) to service_role;

-- Casca em public para o .rpc() da Edge Function.
create or replace function public.fn_reivindicar_aviso_slack(p_chave text, p_tipo text, p_canal text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return cs.fn_reivindicar_aviso_slack(p_chave, p_tipo, p_canal);
end
$fn$;

comment on function public.fn_reivindicar_aviso_slack(text, text, text) is
  '0323: porta do .rpc() para cs.fn_reivindicar_aviso_slack (cs não é exposto no PostgREST). Só service_role.';

revoke execute on function public.fn_reivindicar_aviso_slack(text, text, text) from public, anon, authenticated;
grant execute on function public.fn_reivindicar_aviso_slack(text, text, text) to service_role;

-- ── A liberação ──────────────────────────────────────────────────────────────
-- Se o Slack não confirmar (HTTP ≠ 2xx, timeout, exceção), a Edge Function apaga a
-- reivindicação para que o próximo envio do mesmo evento possa publicar. Sem isto,
-- uma falha do Slack consumia a chave e o aviso se perdia para sempre. Delete pela
-- PK inteira: nunca apaga mais de uma linha. Devolve true se havia linha.
create or replace function cs.fn_liberar_aviso_slack(p_chave text, p_tipo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from cs.slack_notificacao_compra
   where hotmart_transaction = p_chave and tipo = p_tipo;
  return found;
end
$fn$;

comment on function cs.fn_liberar_aviso_slack(text, text) is
  '0323: desfaz a reivindicação de um aviso cujo envio ao Slack falhou, para o próximo envio do evento publicar. Só service_role.';

revoke execute on function cs.fn_liberar_aviso_slack(text, text) from public, anon, authenticated;
grant execute on function cs.fn_liberar_aviso_slack(text, text) to service_role;

create or replace function public.fn_liberar_aviso_slack(p_chave text, p_tipo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return cs.fn_liberar_aviso_slack(p_chave, p_tipo);
end
$fn$;

comment on function public.fn_liberar_aviso_slack(text, text) is
  '0323: porta do .rpc() para cs.fn_liberar_aviso_slack (cs não é exposto no PostgREST). Só service_role.';

revoke execute on function public.fn_liberar_aviso_slack(text, text) from public, anon, authenticated;
grant execute on function public.fn_liberar_aviso_slack(text, text) to service_role;

-- A função antiga continua funcionando: vira casca com tipo VENDA. Se a original não
-- devolver boolean, o create or replace falha e a transação inteira volta — seguro.
create or replace function cs.fn_reivindicar_notificacao_slack(p_transaction text, p_canal text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return cs.fn_reivindicar_aviso_slack(p_transaction, 'VENDA', p_canal);
end
$fn$;

revoke execute on function cs.fn_reivindicar_notificacao_slack(text, text) from public, anon, authenticated;
grant execute on function cs.fn_reivindicar_notificacao_slack(text, text) to service_role;

-- ── Teste embutido (padrão 0294): prova a atomicidade antes de fechar ─────────
do $$
declare a boolean; b boolean; c boolean; l boolean; d boolean; v int;
begin
  a := public.fn_reivindicar_aviso_slack('MIGRATION_TESTE_0323', 'RECUSA', 'TESTE');
  b := public.fn_reivindicar_aviso_slack('MIGRATION_TESTE_0323', 'RECUSA', 'TESTE');
  c := public.fn_reivindicar_aviso_slack('MIGRATION_TESTE_0323', 'VENDA', 'TESTE');
  if a is distinct from true or b is distinct from false or c is distinct from true then
    raise exception '0323: reivindicação errada (1ª=%, 2ª=%, outro tipo=%) — esperado true/false/true', a, b, c;
  end if;
  -- Liberar RECUSA não pode tocar na VENDA da mesma chave; depois de liberada,
  -- a RECUSA volta a ser reivindicável.
  l := public.fn_liberar_aviso_slack('MIGRATION_TESTE_0323', 'RECUSA');
  select count(*) into v from cs.slack_notificacao_compra
   where hotmart_transaction = 'MIGRATION_TESTE_0323' and tipo = 'VENDA';
  d := public.fn_reivindicar_aviso_slack('MIGRATION_TESTE_0323', 'RECUSA', 'TESTE');
  if l is distinct from true or v <> 1 or d is distinct from true then
    raise exception '0323: liberação errada (liberou=%, vendas restantes=%, re-reivindicou=%)', l, v, d;
  end if;
  delete from cs.slack_notificacao_compra where hotmart_transaction = 'MIGRATION_TESTE_0323';
  raise notice '0323: reivindicação atômica e liberação testadas.';
end $$;

commit;

-- ── Verificação (rodar à mão, depois de aplicar) ─────────────────────────────
-- 1) Permissões: só service_role (e o dono) executam.
--    select p.oid::regprocedure, p.proacl from pg_proc p
--     where p.proname in ('fn_reivindicar_aviso_slack', 'fn_liberar_aviso_slack', 'fn_reivindicar_notificacao_slack');
--    select has_function_privilege('anon', 'public.fn_reivindicar_aviso_slack(text,text,text)', 'execute'); -- false
--    select has_function_privilege('authenticated', 'public.fn_reivindicar_aviso_slack(text,text,text)', 'execute'); -- false
--    select has_function_privilege('anon', 'public.fn_liberar_aviso_slack(text,text)', 'execute'); -- false
--    select has_function_privilege('authenticated', 'public.fn_liberar_aviso_slack(text,text)', 'execute'); -- false
--
-- 2) Plano do caminho quente. O EXPLAIN ANALYZE EXECUTA o insert: só dentro de
--    transação com rollback.
--    begin;
--    explain (analyze, buffers)
--      insert into cs.slack_notificacao_compra (hotmart_transaction, tipo, canal, notificado_em)
--      values ('EXPLAIN_0323', 'VENDA', 'TESTE', now())
--      on conflict (hotmart_transaction, tipo) do nothing returning true;
--    rollback;
--
-- 3) Depois do deploy, duplicata por chave tem de ser zero:
--    select hotmart_transaction, tipo, count(*) from cs.slack_notificacao_compra
--     group by 1, 2 having count(*) > 1;   -- impossível pela PK; serve de sanidade

-- ── DOWN (reverter à mão) ────────────────────────────────────────────────────
-- Nada é apagado: as linhas não-VENDA vão para uma tabela de arquivo antes de a
-- PK voltar a ser só hotmart_transaction (elas colidiriam com a VENDA da mesma
-- transação). Reverter a Edge Function (v92 / HEAD anterior) ANTES deste down.
--
-- begin;
-- create table if not exists cs.slack_notificacao_compra_arquivo_0323 as
--   select * from cs.slack_notificacao_compra where false;
-- insert into cs.slack_notificacao_compra_arquivo_0323
--   select * from cs.slack_notificacao_compra where tipo <> 'VENDA';
-- delete from cs.slack_notificacao_compra where tipo <> 'VENDA';
-- revoke all on cs.slack_notificacao_compra_arquivo_0323 from public, anon, authenticated;
-- -- Corpo ORIGINAL (pg_get_functiondef lido no banco antes da 0323). Precisa vir
-- -- DEPOIS da troca da PK: o `on conflict (hotmart_transaction)` exige a PK de 1
-- -- coluna. Grants originais não foram medidos: o down não concede nada novo.
-- drop function if exists public.fn_liberar_aviso_slack(text, text);
-- drop function if exists cs.fn_liberar_aviso_slack(text, text);
-- drop function if exists public.fn_reivindicar_aviso_slack(text, text, text);
-- drop function if exists cs.fn_reivindicar_aviso_slack(text, text, text);
-- alter table cs.slack_notificacao_compra drop constraint slack_notificacao_compra_pkey;
-- alter table cs.slack_notificacao_compra add constraint slack_notificacao_compra_pkey primary key (hotmart_transaction);
-- alter table cs.slack_notificacao_compra drop constraint slack_notificacao_compra_tipo_check;
-- alter table cs.slack_notificacao_compra drop column tipo;
-- CREATE OR REPLACE FUNCTION cs.fn_reivindicar_notificacao_slack(p_transaction text, p_canal text)
--  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'cs', 'public'
-- AS $$ insert into cs.slack_notificacao_compra (hotmart_transaction, canal) values (p_transaction, p_canal) on conflict (hotmart_transaction) do nothing returning true; $$;
-- commit;
