-- =====================================================================
-- 0097_hm_historico_de_versoes
--
-- VERSÃO COMO NA PLANILHA (sugestão da Dra. Elaine). O "desfazer último" (0095)
-- era um passo só; o que o time quer é o que o Google Sheets faz: VER as versões
-- e RECUPERAR qualquer uma.
--
-- Cada edição de campo passa a empilhar uma versão — o estado das colunas
-- editáveis ANTES da edição, com quem editou, quando e o quê. A ficha lista as
-- versões; recuperar uma restaura o card para aquele estado. Recuperar é em si
-- reversível: antes de sobrescrever, o estado atual vira mais uma versão.
--
-- Mantém as 30 versões mais recentes por card (edição não é tão frequente; 30
-- cobre semanas). Substitui a tabela de undo único (cs.hm_undo), que vira caso
-- particular disto: "desfazer" = recuperar a versão mais recente.
-- Idempotente.
-- =====================================================================

create table if not exists cs.hm_versoes (
  id            bigserial primary key,
  contato_hm_id uuid not null references cs.contatos_hm(id) on delete cascade,
  comprador_id  uuid not null,
  snapshot      jsonb not null,          -- estado das colunas editáveis ANTES da edição
  resumo        text not null,           -- o que a edição mudou
  autor         text,
  criado_em     timestamptz not null default now()
);
create index if not exists ix_hm_versoes_card on cs.hm_versoes (contato_hm_id, criado_em desc, id desc);

grant select on cs.hm_versoes to disparos_app;
grant usage on sequence cs.hm_versoes_id_seq to disparos_app;

-- Registrar: empilha o estado atual como uma versão e poda para 30. Chamado pela
-- rota logo ANTES de aplicar a edição — a versão é o "como estava".
create or replace function cs.fn_hm_undo_registrar(p_comprador_id uuid, p_resumo text, p_autor text)
returns void
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_id    uuid;
  v_todas jsonb;
  v_snap  jsonb;
begin
  select ch.id, to_jsonb(ch.*) into v_id, v_todas from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
  if v_id is null then return; end if;

  select jsonb_object_agg(e.key, e.value) into v_snap
    from jsonb_each(v_todas) e
   where e.key = any(cs.fn_hm_undo_colunas());
  if v_snap is null then return; end if;

  insert into cs.hm_versoes (contato_hm_id, comprador_id, snapshot, resumo, autor)
  values (v_id, p_comprador_id, v_snap, coalesce(nullif(btrim(p_resumo), ''), 'edição da ficha'), p_autor);

  delete from cs.hm_versoes v
   where v.contato_hm_id = v_id
     and v.id not in (
       select id from cs.hm_versoes where contato_hm_id = v_id order by criado_em desc, id desc limit 30
     );
end$fn$;

-- Recuperar uma versão específica (ou a mais recente, com p_versao_id nulo).
create or replace function cs.fn_hm_versao_restaurar(p_comprador_id uuid, p_versao_id bigint, p_autor text)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_id     uuid;
  v_snap   jsonb;
  v_resumo text;
  v_quando timestamptz;
  v_cols   text;
begin
  select ch.id into v_id from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'nao_encontrado'); end if;

  if p_versao_id is null then
    select id into p_versao_id from cs.hm_versoes where contato_hm_id = v_id order by criado_em desc, id desc limit 1;
  end if;

  select snapshot, resumo, criado_em into v_snap, v_resumo, v_quando
    from cs.hm_versoes where id = p_versao_id and contato_hm_id = v_id;
  if v_snap is null then return jsonb_build_object('ok', false, 'reason', 'nada_a_recuperar'); end if;

  -- O estado atual vira uma versão antes de ser sobrescrito — recuperar é reversível.
  perform cs.fn_hm_undo_registrar(p_comprador_id, 'antes de recuperar versão', p_autor);

  select string_agg(format('%I', k.key), ', ') into v_cols from jsonb_object_keys(v_snap) k(key);
  execute format(
    'update cs.contatos_hm set (%1$s) = (select %1$s from jsonb_populate_record(null::cs.contatos_hm, $1)), atualizado_em = now() where id = $2',
    v_cols
  ) using v_snap, v_id;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_id, 'sistema', 'Recuperou a versão de ' || to_char(v_quando, 'DD/MM HH24:MI') || ' (' || v_resumo || ')', p_autor);

  return jsonb_build_object('ok', true, 'resumo', v_resumo);
end$fn$;

-- "Desfazer" continua existindo — é recuperar a versão mais recente.
create or replace function cs.fn_hm_undo_aplicar(p_comprador_id uuid, p_autor text)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
begin
  return cs.fn_hm_versao_restaurar(p_comprador_id, null, p_autor);
end$fn$;

grant execute on function cs.fn_hm_versao_restaurar(uuid, bigint, text) to disparos_app;

-- A tabela de undo único não é mais necessária.
drop table if exists cs.hm_undo;
