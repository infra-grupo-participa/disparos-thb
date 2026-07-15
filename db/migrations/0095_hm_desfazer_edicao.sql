-- =====================================================================
-- 0095_hm_desfazer_edicao
--
-- DESFAZER A ÚLTIMA EDIÇÃO DA FICHA (A2). Decidido com o time: só um passo de
-- volta — não histórico de versões.
--
-- Antes de aplicar uma edição de campo, o banco guarda o estado ANTERIOR das
-- colunas editáveis do card (uma linha por card, sempre a última edição). O
-- "Desfazer" restaura esse estado e apaga o registro — não dá para desfazer
-- duas vezes, porque é isso que "a última edição" significa.
--
-- Escopo: os campos da ficha em cs.contatos_hm (o que a edição administrativa e a
-- inline mexem). Não cobre a MUDANÇA DE ETAPA — essa já tem o seu próprio desfazer
-- (reverterEstagioHm), que sabe recolocar o card na coluna certa. Não cobre
-- nome/e-mail (compradores): nome é normalizado por gatilho (0093) e o resto é
-- raro; misturar duas tabelas no mesmo undo traria mais risco que valor.
-- Idempotente.
-- =====================================================================

create table if not exists cs.hm_undo (
  contato_hm_id uuid primary key references cs.contatos_hm(id) on delete cascade,
  comprador_id  uuid not null,
  antes         jsonb not null,          -- { coluna: valor_anterior, … }
  resumo        text not null,           -- rótulo do que foi editado (para o botão)
  autor         text,
  criado_em     timestamptz not null default now()
);

-- As colunas que o desfazer cobre — as editáveis pela ficha/admin. Fora daqui:
-- estagio_id, apto_ativacao e os campos de sistema (quem os mexe tem caminho próprio).
create or replace function cs.fn_hm_undo_colunas()
returns text[] language sql immutable as $fn$
  select array[
    'responsavel','turma','turma_origem','plano','observacoes',
    'reuniao_resultado','entrevista_resultado',
    'pagamento_meio','pagamento_previsto_em','acordo','oferta_saldo_codigo','link_saldo_enviado_em',
    'nao_contatar','nao_contatar_motivo','revisar','revisar_motivo',
    'ativ_searchie','ativ_comunidade','ativ_grupo','ativ_pesquisa','grupo_informes','pendencia',
    'cancelamento_motivo','link_facebook',
    'rev_searchie','rev_comunidade','rev_grupo','rev_pesquisa',
    'credito_oferta','credito_valor_pago','credito_dias_totais','credito_compra_em',
    'valor_total','valor_pago','pagamento_em','cancelamento_em','tags'
  ]::text[];
$fn$;

-- Snapshot do estado ANTES da edição. Chamado pela rota logo antes de aplicar a
-- mudança. Upsert por card: só a última edição fica desfazível.
create or replace function cs.fn_hm_undo_registrar(p_comprador_id uuid, p_resumo text, p_autor text)
returns void
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_id    uuid;
  v_todas jsonb;
  v_antes jsonb;
begin
  select ch.id, to_jsonb(ch.*) into v_id, v_todas from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
  if v_id is null then return; end if;

  select jsonb_object_agg(e.key, e.value) into v_antes
    from jsonb_each(v_todas) e
   where e.key = any(cs.fn_hm_undo_colunas());
  if v_antes is null then return; end if;

  insert into cs.hm_undo (contato_hm_id, comprador_id, antes, resumo, autor)
  values (v_id, p_comprador_id, v_antes, coalesce(nullif(btrim(p_resumo), ''), 'edição da ficha'), p_autor)
  on conflict (contato_hm_id) do update
    set antes = excluded.antes, resumo = excluded.resumo, autor = excluded.autor, criado_em = now();
end$fn$;

-- Restaura o snapshot. jsonb_populate_record tipa cada valor de volta para a
-- coluna certa; só as colunas guardadas entram no SET (as demais ficam intactas).
create or replace function cs.fn_hm_undo_aplicar(p_comprador_id uuid, p_autor text)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_id     uuid;
  v_antes  jsonb;
  v_resumo text;
  v_cols   text;
begin
  select u.contato_hm_id, u.antes, u.resumo into v_id, v_antes, v_resumo
    from cs.hm_undo u join cs.contatos_hm ch on ch.id = u.contato_hm_id
   where ch.comprador_id = p_comprador_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'nada_a_desfazer');
  end if;

  select string_agg(format('%I', k.key), ', ') into v_cols from jsonb_object_keys(v_antes) k(key);
  execute format(
    'update cs.contatos_hm set (%1$s) = (select %1$s from jsonb_populate_record(null::cs.contatos_hm, $1)), atualizado_em = now() where id = $2',
    v_cols
  ) using v_antes, v_id;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_id, 'sistema', 'Desfez a última edição (' || v_resumo || ')', p_autor);

  delete from cs.hm_undo where contato_hm_id = v_id;   -- desfazer é passo único
  return jsonb_build_object('ok', true, 'resumo', v_resumo);
end$fn$;

grant execute on function cs.fn_hm_undo_colunas() to disparos_app;
grant execute on function cs.fn_hm_undo_registrar(uuid, text, text) to disparos_app;
grant execute on function cs.fn_hm_undo_aplicar(uuid, text) to disparos_app;
grant select, insert, update, delete on cs.hm_undo to disparos_app;
