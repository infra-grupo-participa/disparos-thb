-- 0294_o_log_do_webhook_volta_por_rpc
--
-- APLICADA EM PRODUÇÃO EM 18/08/2026. Este arquivo é o registro do que já está
-- rodando — foi escrito a partir do que foi efetivamente executado, não o
-- contrário. Idempotente: reaplicar é seguro (create or replace + grant).
--
-- ── O sintoma ────────────────────────────────────────────────────────────────
-- cs.hotmart_eventos parado desde 17/07/2026 18:04 — 32 dias — enquanto as
-- compras seguiam entrando normalmente (509 compras e 15 reembolsos no mesmo
-- período). O webhook NUNCA parou; morreu só a auditoria.
--
-- ── A causa ──────────────────────────────────────────────────────────────────
-- A Edge Function grava com
--   supabase.schema("cs").from("hotmart_eventos").insert(...)
-- que passa pela API REST. O schema `cs` NÃO está em pgrst.db_schemas e não tem
-- grant para service_role:
--   select has_schema_privilege('service_role','cs','USAGE')            -> false
--   select has_table_privilege('service_role','cs.hotmart_eventos','INSERT') -> false
-- Resultado: HTTP 406 em toda tentativa (71 registradas nos logs), engolido por
-- um try/catch que só fazia console.error "para não derrubar o webhook".
-- Falhou em silêncio por um mês.
--
-- NÃO tem relação com a redução de egress de 04-05/08: o log morreu três
-- semanas ANTES. A tabela nasceu na 0090, aplicada direto no banco em 14/07,
-- sem o grant e sem entrar em pgrst.db_schemas.
--
-- ── O que era pior que o log ─────────────────────────────────────────────────
-- O MESMO 406 atingia alertaProdutoNaoMapeado -> cs.hm_alertas. Por isso
-- `produto_nao_mapeado` NUNCA disparou uma única vez (0 linhas do tipo). É o
-- caminho pelo qual uma venda de produto desconhecido é descartada com HTTP
-- 200, sem log e sem alerta — foi assim que o AURUM passou despercebido, e o
-- conserto de 15/08 (R$ 206.655,76) foi construído sobre dois inserts que não
-- funcionavam.
--
-- ── Por que RPC e não expor o schema ─────────────────────────────────────────
-- A alternativa seria `alter role authenticator set pgrst.db_schemas = '... , cs'`
-- + grants. Recusada: (a) `cs` é schema interno de CS e expô-lo na REST aumenta
-- a superfície de ataque; (b) a lista de db_schemas é global — errar nela
-- derruba TODAS as outras integrações de uma vez. O caminho abaixo é o padrão
-- que já funciona neste projeto desde a 0091 (fn_hm_cancelar_por_transacao):
-- função SECURITY DEFINER em `public`, chamada por .rpc().
--
-- ⚠️ cs.hotmart_eventos.id é bigint (não uuid) — a primeira versão desta
-- migration declarava `returns uuid` e falhou no próprio teste embutido no fim
-- do arquivo, antes de qualquer uso real. O teste é o que pegou.

create or replace function public.fn_log_evento_hotmart(
  p_evento text,
  p_transacao text default null,
  p_email text default null,
  p_payload jsonb default null
) returns bigint
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare v_id bigint;
begin
  insert into cs.hotmart_eventos (evento, transacao, email, payload)
  values (p_evento, p_transacao, p_email, p_payload)
  returning id into v_id;
  return v_id;
end$fn$;

comment on function public.fn_log_evento_hotmart(text, text, text, jsonb) is
  '0294: porta de entrada do log cru do webhook da Hotmart. Existe porque o schema cs nao e exposto no PostgREST — a Edge Function batia 406 ao inserir direto em cs.hotmart_eventos e perdeu 32 dias de auditoria em silencio. SECURITY DEFINER em public, mesmo padrao de fn_hm_cancelar_por_transacao (0091). A Edge Function deve chamar .rpc("fn_log_evento_hotmart", {...}) em vez de .schema("cs").from("hotmart_eventos").insert(...).';

grant execute on function public.fn_log_evento_hotmart(text, text, text, jsonb) to service_role;

-- A dedupe do alerta vive no `on conflict do nothing`, que funciona porque
-- existe o índice único parcial hm_alertas_aberto_uniq (tipo, chave) where
-- resolvido_em is null — conferido no banco. Por isso a Edge Function não
-- precisa mais fazer o SELECT prévio de "já existe alerta aberto?" (que também
-- batia 406).
create or replace function public.fn_alerta_hotmart(
  p_tipo text,
  p_chave text,
  p_severidade text,
  p_detalhe text
) returns boolean
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  values (p_tipo, p_chave, p_severidade, p_detalhe)
  on conflict do nothing;
  return true;
end$fn$;

comment on function public.fn_alerta_hotmart(text, text, text, text) is
  '0294: porta de entrada dos alertas levantados pela Edge Function do webhook (produto_nao_mapeado etc). Mesmo motivo da fn_log_evento_hotmart: cs nao e exposto no PostgREST e o insert direto batia 406 — por isso produto_nao_mapeado NUNCA disparou, e foi assim que o AURUM entrou sem ninguem ver. A Edge Function deve chamar .rpc("fn_alerta_hotmart", {...}).';

grant execute on function public.fn_alerta_hotmart(text, text, text, text) to service_role;

-- ── Teste embutido: prova a porta antes de fechar a migration ────────────────
do $$
declare v_id bigint;
begin
  v_id := public.fn_log_evento_hotmart('MIGRATION_TESTE_0294', 'teste-0294', 'teste@0294.local',
            jsonb_build_object('origem', '0294', 'nota', 'linha de teste da propria migration'));
  if v_id is null then
    raise exception '0294: fn_log_evento_hotmart nao devolveu id — a porta nao funcionou.';
  end if;
  delete from cs.hotmart_eventos where id = v_id;
  raise notice '0294: fn_log_evento_hotmart testada e funcionando.';
end $$;

-- ── Verificação (rodar à mão) ────────────────────────────────────────────────
-- A prova de que o log voltou só aparece no PRÓXIMO evento que a Hotmart
-- mandar — não dá para forçar sem inventar venda falsa em produção.
--
-- select count(*), max(recebido_em), current_date - max(recebido_em)::date as dias
--   from cs.hotmart_eventos;
--
-- Se `dias` andar para 0 depois de uma venda nova, acabou o silêncio. Se
-- continuar em 32+ com compras entrando em public.compras, a RPC está sendo
-- recusada por outro motivo — e agora o erro aparece no console da Edge
-- Function ("[DB] fn_log_evento_hotmart recusou o evento: ..."), em vez de
-- silêncio indistinguível de sucesso.
