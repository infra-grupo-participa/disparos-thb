-- 0220 — o "desfazer edição" também escolhia o card no escuro
--
-- ACHADO NO ENSAIO DA 0219 (12/08/2026), não em revisão de código: o teste em
-- transação revertida restaurou uma versão e o campo NÃO voltou. Não era a trava
-- nova funcionando — era a função escrevendo no card errado.
--
--   cs.fn_hm_undo_registrar:   select ch.id into v_id from cs.contatos_hm ch
--   cs.fn_hm_versao_restaurar:  where ch.comprador_id = p_comprador_id;
--
-- Sem `and ch.produto = ...`, sem `order by`, sem `limit`. É a MESMA classe de
-- bug que a 0196/0197 fechou em sete funções do dinheiro e que a 0218 acabou de
-- fechar no cancelamento por transação: desde a 0163 o card é por pessoa ×
-- produto, e `select ... into` sem STRICT em PL/pgSQL não erra com duas linhas —
-- pega uma, na ordem que o planner quiser, sem avisar ninguém.
--
-- Hoje são 15 pessoas com card no HM e no AURUM. Para elas, o histórico de
-- versões da ficha (0097) vinha gravando o retrato de um card e restaurando por
-- cima do outro. Ninguém reclamou porque o sintoma é mudo: você aperta
-- "desfazer", a tela recarrega e o campo continua como estava.
--
-- A correção passa o PRODUTO, que o chamador sempre sabe (a rota já resolve
-- `produtoCard` para ancorar todas as outras escritas). Default 'HM' preserva o
-- comportamento de quem tem um card só. Como na 0219: DROP das assinaturas
-- antigas antes de recriar — acrescentar argumento por `create or replace` cria
-- uma SEGUNDA função e é exatamente a armadilha que a 0215 pagou caro.

begin;

drop function if exists cs.fn_hm_undo_aplicar(uuid, text, text[]);
drop function if exists cs.fn_hm_versao_restaurar(uuid, bigint, text, text[]);
drop function if exists cs.fn_hm_undo_registrar(uuid, text, text);

create or replace function cs.fn_hm_undo_registrar(
  p_comprador_id uuid, p_resumo text, p_autor text, p_produto text default 'HM'
) returns void
language plpgsql security definer set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_id uuid; v_todas jsonb; v_snap jsonb;
begin
  -- 0220: pelo CARD do produto. `order by`+`limit` como rede: dado legado com
  -- produto nulo/divergente não pode voltar a cair no card ao acaso.
  select ch.id, to_jsonb(ch.*) into v_id, v_todas
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador_id
     and coalesce(ch.produto, 'HM') = coalesce(p_produto, 'HM')
   order by ch.criado_em asc
   limit 1;
  if v_id is null then return; end if;

  select jsonb_object_agg(e.key, e.value) into v_snap
    from jsonb_each(v_todas) e
   where e.key = any(cs.fn_hm_undo_colunas());
  if v_snap is null then return; end if;

  insert into cs.hm_versoes (contato_hm_id, comprador_id, snapshot, resumo, autor)
  values (v_id, p_comprador_id, v_snap, coalesce(nullif(btrim(p_resumo), ''), 'edicao da ficha'), p_autor);

  delete from cs.hm_versoes v
   where v.contato_hm_id = v_id
     and v.id not in (
       select id from cs.hm_versoes where contato_hm_id = v_id order by criado_em desc, id desc limit 30
     );
end$fn$;

create or replace function cs.fn_hm_versao_restaurar(
  p_comprador_id uuid, p_versao_id bigint, p_autor text,
  p_colunas_travadas text[] default null, p_produto text default 'HM'
) returns jsonb
language plpgsql security definer set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_id uuid; v_snap jsonb; v_resumo text; v_quando timestamptz;
  v_cols text; v_bloqueadas text[];
begin
  select ch.id into v_id
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador_id
     and coalesce(ch.produto, 'HM') = coalesce(p_produto, 'HM')
   order by ch.criado_em asc
   limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'nao_encontrado'); end if;

  if p_versao_id is null then
    select id into p_versao_id from cs.hm_versoes where contato_hm_id = v_id order by criado_em desc, id desc limit 1;
  end if;

  -- `and contato_hm_id = v_id` já impedia restaurar a versão de OUTRO card por
  -- id — o furo era o v_id errado, não a versão.
  select snapshot, resumo, criado_em into v_snap, v_resumo, v_quando
    from cs.hm_versoes where id = p_versao_id and contato_hm_id = v_id;
  if v_snap is null then return jsonb_build_object('ok', false, 'reason', 'nada_a_recuperar'); end if;

  -- 0219: as colunas que ESTE chamador não pode restaurar saem do snapshot.
  if p_colunas_travadas is not null and array_length(p_colunas_travadas, 1) > 0 then
    select array_agg(k) into v_bloqueadas from unnest(p_colunas_travadas) k where v_snap ? k;
    v_snap := v_snap - p_colunas_travadas;
  end if;

  if v_snap = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'resumo', v_resumo, 'nada_restaurado', true,
      'colunas_bloqueadas', to_jsonb(coalesce(v_bloqueadas, '{}'::text[])));
  end if;

  perform cs.fn_hm_undo_registrar(p_comprador_id, 'antes de recuperar versao', p_autor, p_produto);

  select string_agg(format('%I', k.key), ', ') into v_cols from jsonb_object_keys(v_snap) k(key);
  execute format(
    'update cs.contatos_hm set (%1$s) = (select %1$s from jsonb_populate_record(null::cs.contatos_hm, $1)), atualizado_em = now() where id = $2',
    v_cols
  ) using v_snap, v_id;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_id, 'sistema',
    'Recuperou a versao de ' || to_char(v_quando, 'DD/MM HH24:MI') || ' (' || v_resumo || ')'
      || case when v_bloqueadas is not null and array_length(v_bloqueadas, 1) > 0
              then ' -- ' || array_length(v_bloqueadas, 1) || ' coluna(s) travada(s) nao foram restauradas ('
                   || array_to_string(v_bloqueadas, ', ') || ')'
              else '' end,
    p_autor);

  return jsonb_build_object('ok', true, 'resumo', v_resumo,
    'colunas_bloqueadas', to_jsonb(coalesce(v_bloqueadas, '{}'::text[])));
end$fn$;

create or replace function cs.fn_hm_undo_aplicar(
  p_comprador_id uuid, p_autor text, p_colunas_travadas text[] default null, p_produto text default 'HM'
) returns jsonb
language plpgsql security definer set search_path to 'cs', 'public', 'pg_temp'
as $fn$
begin
  return cs.fn_hm_versao_restaurar(p_comprador_id, null, p_autor, p_colunas_travadas, p_produto);
end$fn$;

comment on function cs.fn_hm_undo_registrar(uuid, text, text, text) is
  '0220: grava a versao do CARD do produto pedido. Antes resolvia por comprador_id sem produto e, para as 15 pessoas com card no HM e no AURUM, fotografava um card e restaurava por cima do outro.';
comment on function cs.fn_hm_versao_restaurar(uuid, bigint, text, text[], text) is
  '0219 (4o arg: colunas travadas) + 0220 (5o arg: produto do card). Sem o produto, "desfazer edicao" agia no card errado de quem tem dois boards.';
comment on function cs.fn_hm_undo_aplicar(uuid, text, text[], text) is
  '0220: repassa colunas travadas e produto para fn_hm_versao_restaurar.';

grant execute on function cs.fn_hm_undo_registrar(uuid, text, text, text) to disparos_app;
grant execute on function cs.fn_hm_versao_restaurar(uuid, bigint, text, text[], text) to disparos_app;
grant execute on function cs.fn_hm_undo_aplicar(uuid, text, text[], text) to disparos_app;

-- Rede de segurança da 0215: uma assinatura por nome, sempre.
do $$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cs'
       and p.proname in ('fn_hm_undo_registrar','fn_hm_versao_restaurar','fn_hm_undo_aplicar')
     group by p.proname having count(*) <> 1
  loop
    raise exception '0220: cs.% ficou com % assinaturas — sobrecarga ambigua (0215).', r.proname, r.n;
  end loop;
end $$;

commit;
