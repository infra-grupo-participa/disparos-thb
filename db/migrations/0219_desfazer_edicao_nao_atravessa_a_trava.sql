-- =====================================================================
-- 0219_desfazer_edicao_nao_atravessa_a_trava
--
-- ACHADO DO PENTESTER (12/08/2026, revisão adversarial da 0218/trava da
-- reunião/entrevista finalizada) — BYPASS confirmado, severidade ALTA.
--
-- O 403 `reuniao_finalizada_travada` / `entrevista_finalizada_travada`
-- (app/api/hm/contato/[id]/route.ts) só dispara quando o body do PATCH traz
-- os campos da reunião/entrevista NO NOME (reuniao_em, reuniao_resultado,
-- reuniao_gravacao_url, agendamento_status+tipo — e os quatro gêmeos da
-- entrevista). Um body `{ "desfazer_edicao": true }` ou
-- `{ "restaurar_versao": N }` não casa em NENHUM desses nomes — passa reto
-- pela checagem e cai em `cs.fn_hm_versao_restaurar`, que sobrescreve TODAS
-- as colunas de `cs.fn_hm_undo_colunas()` (0140) de uma vez, sem olhar quem
-- está pedindo. Essa lista inclui `reuniao_resultado`, `entrevista_resultado`,
-- `reuniao_gravacao_url` e `entrevista_gravacao_url` — exatamente as quatro
-- colunas que a trava existe para proteger.
--
-- Ou seja: a equipe de ativação, que é QUEM a trava barra, conseguia
-- reescrever o resultado de uma reunião/entrevista finalizada só pedindo
-- "desfazer edição" ou recuperando uma versão antiga da ficha. Fica
-- registrado na timeline ("Recuperou a versão de..."), o que atenua a
-- auditoria — mas o DADO muda, que é exatamente o que a 0212 (mesmo
-- princípio, para responsavel_comercial_id/responsavel_ativacao_id) e a
-- trava da reunião/entrevista (12/08) foram desenhadas para impedir.
--
-- A CORREÇÃO NÃO tenta comparar snapshots (frágil, e o `desfazer_edicao`
-- pode legitimamente restaurar OUTRO campo qualquer, inclusive numa reunião
-- já finalizada). Em vez disso, `fn_hm_versao_restaurar` ganha um parâmetro
-- opcional — a lista de colunas que este chamador NÃO tem permissão de
-- restaurar — e as remove do snapshot ANTES de montar o UPDATE. O chamador
-- (a rota, que já sabe se `reuniaoFinalizada`/`entrevistaFinalizada` valem e
-- se quem pediu é master) decide a lista; a função só obedece. Mesmo
-- critério de sempre: master corrige, os demais não atravessam a trava por
-- NENHUM caminho — nem pelo nome do campo, nem pelo "desfazer".
--
-- Idempotente. Aditiva: chamada sem o novo argumento (default null) se
-- comporta exatamente como antes.
-- =====================================================================

begin;

-- ⚠️ A ARMADILHA DA 0215, DE NOVO. `create or replace` NÃO troca a lista de
-- argumentos: acrescentar `p_colunas_travadas` cria uma SEGUNDA função e deixa a
-- antiga viva. Com as duas no catálogo, `fn_hm_versao_restaurar($1,$2,$3)` — que
-- é exatamente como a rota chamava até hoje — vira `function ... is not unique` e
-- o Postgres recusa ANTES de executar. Foi assim que 5 alunos pagaram R$ 15.000 e
-- ficaram sem login (0215). Aqui o dano seria o "desfazer edição" quebrando em
-- silêncio para todo mundo.
--
-- Derrubar antes de recriar. Confirmado: nenhuma outra função do schema `cs`
-- referencia estas duas, e o único chamador da aplicação é
-- app/api/hm/contato/[id]/route.ts, que passa os 4 argumentos.
drop function if exists cs.fn_hm_undo_aplicar(uuid, text);
drop function if exists cs.fn_hm_versao_restaurar(uuid, bigint, text);

create or replace function cs.fn_hm_versao_restaurar(
  p_comprador_id     uuid,
  p_versao_id        bigint,
  p_autor            text,
  p_colunas_travadas text[] default null
)
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
  v_bloqueadas text[];
begin
  select ch.id into v_id from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'nao_encontrado'); end if;

  if p_versao_id is null then
    select id into p_versao_id from cs.hm_versoes where contato_hm_id = v_id order by criado_em desc, id desc limit 1;
  end if;

  select snapshot, resumo, criado_em into v_snap, v_resumo, v_quando
    from cs.hm_versoes where id = p_versao_id and contato_hm_id = v_id;
  if v_snap is null then return jsonb_build_object('ok', false, 'reason', 'nada_a_recuperar'); end if;

  -- A TRAVA: remove do snapshot as colunas que este chamador não pode
  -- restaurar (ex.: reuniao_resultado/reuniao_gravacao_url quando a reunião
  -- já foi finalizada e quem pediu não é master). `v_bloqueadas` guarda só as
  -- que de fato estavam no snapshot — para o aviso na timeline não mentir
  -- dizendo que bloqueou algo que nem estava sendo restaurado.
  if p_colunas_travadas is not null and array_length(p_colunas_travadas, 1) > 0 then
    select array_agg(k) into v_bloqueadas
      from unnest(p_colunas_travadas) k
     where v_snap ? k;
    v_snap := v_snap - p_colunas_travadas;
  end if;

  -- Sem nada a restaurar depois de tirar as colunas travadas (snapshot só
  -- tinha, por exemplo, o resultado da reunião) — nada muda, mas isso não é
  -- erro: é o comportamento correto de "esta versão não te diz respeito".
  if v_snap = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'resumo', v_resumo, 'nada_restaurado', true,
      'colunas_bloqueadas', to_jsonb(coalesce(v_bloqueadas, '{}'::text[])));
  end if;

  -- O estado atual vira uma versão antes de ser sobrescrito — recuperar é reversível.
  perform cs.fn_hm_undo_registrar(p_comprador_id, 'antes de recuperar versão', p_autor);

  select string_agg(format('%I', k.key), ', ') into v_cols from jsonb_object_keys(v_snap) k(key);
  execute format(
    'update cs.contatos_hm set (%1$s) = (select %1$s from jsonb_populate_record(null::cs.contatos_hm, $1)), atualizado_em = now() where id = $2',
    v_cols
  ) using v_snap, v_id;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_id, 'sistema',
    'Recuperou a versão de ' || to_char(v_quando, 'DD/MM HH24:MI') || ' (' || v_resumo || ')'
      || case when v_bloqueadas is not null and array_length(v_bloqueadas, 1) > 0
              then ' — ' || array_length(v_bloqueadas, 1) || ' coluna(s) travada(s) não foram restauradas (' || array_to_string(v_bloqueadas, ', ') || ')'
              else '' end,
    p_autor);

  return jsonb_build_object('ok', true, 'resumo', v_resumo,
    'colunas_bloqueadas', to_jsonb(coalesce(v_bloqueadas, '{}'::text[])));
end$fn$;

comment on function cs.fn_hm_versao_restaurar(uuid, bigint, text, text[]) is
  '0219: 4o argumento opcional (default null) = colunas que este chamador NAO pode restaurar; removidas do snapshot antes do UPDATE. Fecha o bypass em que "desfazer edicao"/"restaurar versao" reescrevia reuniao_resultado/entrevista_resultado de um card com a reuniao/entrevista ja finalizada, sem passar pela checagem de nome de campo da rota.';

grant execute on function cs.fn_hm_versao_restaurar(uuid, bigint, text, text[]) to disparos_app;

-- fn_hm_undo_aplicar (o "desfazer" de um passo) chama a mesma função — cobrir
-- também, mesmo argumento opcional, mesmo default seguro.
create or replace function cs.fn_hm_undo_aplicar(p_comprador_id uuid, p_autor text, p_colunas_travadas text[] default null)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
begin
  return cs.fn_hm_versao_restaurar(p_comprador_id, null, p_autor, p_colunas_travadas);
end$fn$;

comment on function cs.fn_hm_undo_aplicar(uuid, text, text[]) is
  '0219: mesmo 4o argumento (colunas travadas) de fn_hm_versao_restaurar — ver comentário lá.';

grant execute on function cs.fn_hm_undo_aplicar(uuid, text, text[]) to disparos_app;

-- ---------------------------------------------------------------------------
-- Trava contra sobrecarga ambígua (mesma rede de segurança da 0215) — as duas
-- funções tocadas aqui ganharam um argumento novo com DEFAULT, o que É a
-- causa raiz do bug da 0215 quando alguém esquece de fazer o `create or
-- replace` bater com a assinatura ANTIGA (aqui bate: 3 args antigos + 1 novo
-- com default, mesma ordem, então chamadas de 3 args continuam válidas SEM
-- criar uma segunda assinatura). Confere mesmo assim.
-- ---------------------------------------------------------------------------
do $$
declare v_restaurar int; v_aplicar int;
begin
  select count(*) into v_restaurar from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_versao_restaurar';
  select count(*) into v_aplicar from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_undo_aplicar';
  if v_restaurar <> 1 then
    raise exception '0219: esperava 1 assinatura de cs.fn_hm_versao_restaurar, achei %. Sobrecarga ambigua — DROP a antiga.', v_restaurar;
  end if;
  if v_aplicar <> 1 then
    raise exception '0219: esperava 1 assinatura de cs.fn_hm_undo_aplicar, achei %. Sobrecarga ambigua — DROP a antiga.', v_aplicar;
  end if;
end $$;

commit;
