-- 0257_promocao_controlada_do_catalogo.sql
-- A função que leva uma linha de `cs.oferta_planilha_staging` (0256) para
-- `public.hm_product_catalog` — SÓ quando um humano confirma na tela
-- ({base}/ofertas, B6/F6). Nenhuma rota promove sozinha; nenhum cron chama
-- esta função.
--
-- ---------------------------------------------------------------------------
-- POR QUE FUNÇÃO SECURITY DEFINER, E NÃO UM SIMPLES INSERT DA ROTA
--
-- A role `disparos_app` não tem GRANT em `public.hm_product_catalog` — a 0044
-- já registra isso ("a role NÃO tem select em public.compras nem em
-- public.hm_product_catalog"). A ponte é sempre uma função SECURITY DEFINER
-- (dona postgres), padrão já usado em 0044/0075/0082/0200. A rota chama
-- `select * from cs.fn_oferta_planilha_promover($1, $2)`; a role só recebe
-- EXECUTE, nunca INSERT/UPDATE direto na tabela.
--
-- ---------------------------------------------------------------------------
-- POR QUE UPDATE CONDICIONAL, E NÃO `ON CONFLICT (offer_code) DO UPDATE`
--
-- Não há prova no repositório de que `offer_code` tenha unique/PK em
-- `public.hm_product_catalog` (a tabela foi criada fora do histórico de
-- migrations — achado do analista de dados, 16/08: "o repo não reproduz o
-- catálogo de produção"). A própria 0077 evita ON CONFLICT nesta tabela e usa
-- `insert ... where not exists`. Esta função segue o MESMO padrão: checa
-- existência, INSERT se nova, UPDATE condicional se já existe.
--
-- ---------------------------------------------------------------------------
-- "NUNCA SOBRESCREVE VALOR JÁ CLASSIFICADO POR HUMANO" — como isso é garantido
--
-- No UPDATE, cada coluna usa `coalesce(coluna_atual, valor_da_planilha)`: só
-- entra onde a coluna JÁ ERA NULA. `pacote_cheio`, `entrada_condicao_fechada`,
-- `entrada_do_programa`, `concede_trilha` e `categoria` — a RÉGUA financeira —
-- não aparecem em lugar nenhum desta função: promoção da planilha NUNCA toca
-- nelas, só nas colunas descritivas da 0255.
--
-- IDEMPOTENTE por linha de staging: se `origem_ref = 'staging:<id>'` já
-- existir no catálogo para aquele offer_code, a função devolve `ja_promovido`
-- sem tocar em nada — promover a mesma linha duas vezes (clique duplo, retry
-- de rede) não escreve duas vezes nem apaga o que já estava lá.
--
-- Quarentena (motivo_quarentena not null) e linha sem offer_code NUNCA
-- promovem — a função recusa e devolve o motivo; quem decide destravar é o
-- humano na tela, reimportando um lote novo (0256) ou editando o catálogo
-- direto (fora desta função).

-- ---------------------------------------------------------------------------
-- CONTAR ANTES (rodar e colar a saída antes de aplicar — mostra o tamanho do
-- efeito quando alguém começar a promover pela tela: quantas linhas limpas
-- existem, quantas já têm offer_code no catálogo e, dessas, quantas JÁ têm
-- valor_tabela preenchido por humano — que é exatamente o que a função tem
-- que preservar):
--
--   select count(*)                                                             as staging_limpo,
--          count(*) filter (where exists (
--            select 1 from public.hm_product_catalog c where c.offer_code = s.offer_code
--          ))                                                                   as ja_no_catalogo,
--          count(*) filter (where exists (
--            select 1 from public.hm_product_catalog c
--             where c.offer_code = s.offer_code and c.valor_tabela is not null
--          ))                                                                   as ja_tem_valor_tabela
--     from cs.oferta_planilha_staging s
--    where s.motivo_quarentena is null;
-- ---------------------------------------------------------------------------

create or replace function cs.fn_oferta_planilha_promover(p_staging_id bigint, p_por text)
returns table (ok boolean, offer_code text, acao text, motivo text)
language plpgsql
volatile
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v         cs.oferta_planilha_staging%rowtype;
  v_existe  boolean;
  v_ja_feito boolean;
begin
  -- Toda referência a public.hm_product_catalog abaixo vai QUALIFICADA por alias
  -- (`c.offer_code`): a função tem uma coluna OUT chamada `offer_code` e o Postgres
  -- não resolve a ambiguidade sozinho — erro 42702 na primeira promoção real (17/08).
  select * into v from cs.oferta_planilha_staging s where s.id = p_staging_id;
  if not found then
    return query select false, null::text, 'nenhuma'::text, 'linha de staging não encontrada';
    return;
  end if;

  if v.motivo_quarentena is not null then
    return query select false, v.offer_code, 'nenhuma'::text, 'em quarentena: ' || v.motivo_quarentena;
    return;
  end if;

  if v.offer_code is null or length(trim(v.offer_code)) = 0 then
    return query select false, null::text, 'nenhuma'::text, 'linha sem offer_code -- não é promovível';
    return;
  end if;

  -- Idempotência: já promovida antes (clique duplo / retry)?
  select exists(
    select 1 from public.hm_product_catalog c
     where c.offer_code = v.offer_code and c.origem_ref = 'staging:' || v.id
  ) into v_ja_feito;
  if v_ja_feito then
    return query select true, v.offer_code, 'ja_promovido'::text, null::text;
    return;
  end if;

  select exists(
    select 1 from public.hm_product_catalog c where c.offer_code = v.offer_code
  ) into v_existe;

  if not v_existe then
    insert into public.hm_product_catalog as c
      (offer_code, nome_comercial, valor_tabela, explicacao, link, produto_checkout,
       origem_do_dado, origem_ref, atualizado_por, atualizado_em)
    values
      (v.offer_code, nullif(v.produto_txt, ''), v.valor_num_planilha, nullif(v.explicacao_txt, ''),
       v.link, v.produto_checkout, 'planilha', 'staging:' || v.id, p_por, now());

    return query select true, v.offer_code, 'inserido'::text, null::text;
    return;
  end if;

  -- Já existe: só entra onde a coluna está NULA hoje. `origem_do_dado`
  -- original NÃO muda aqui (a linha pode já ser 'migration'/'manual' — a
  -- planilha só está PREENCHENDO GAPS, não reclassificando a origem).
  update public.hm_product_catalog as c set
    nome_comercial   = coalesce(c.nome_comercial, nullif(v.produto_txt, '')),
    valor_tabela     = coalesce(c.valor_tabela, v.valor_num_planilha),
    explicacao       = coalesce(c.explicacao, nullif(v.explicacao_txt, '')),
    link             = coalesce(c.link, v.link),
    produto_checkout = coalesce(c.produto_checkout, v.produto_checkout),
    origem_ref       = coalesce(c.origem_ref, 'staging:' || v.id),
    atualizado_por   = p_por,
    atualizado_em    = now()
  where c.offer_code = v.offer_code;

  return query select true, v.offer_code, 'atualizado'::text, null::text;
end;
$fn$;

comment on function cs.fn_oferta_planilha_promover(bigint, text) is
  '0257: promove UMA linha de cs.oferta_planilha_staging para
   public.hm_product_catalog. Recusa quarentena e linha sem offer_code.
   Idempotente por staging_id. UPDATE só preenche coluna NULA — nunca
   sobrescreve valor já classificado por humano. Nunca toca pacote_cheio,
   entrada_condicao_fechada, entrada_do_programa, concede_trilha, categoria.';

revoke all on function cs.fn_oferta_planilha_promover(bigint, text) from public;
grant execute on function cs.fn_oferta_planilha_promover(bigint, text) to disparos_app;

-- ---------------------------------------------------------------------------
-- Promoção em LOTE — a tela de conferência (F6) confirma várias linhas de
-- uma vez ("casou" já revisado); esta função só chama a de cima em loop e
-- devolve uma linha de resultado por staging_id, para a tela mostrar o que
-- promoveu, o que já tinha sido promovido e o que foi recusado (e por quê).
-- Nunca promove quarentena — mesmo que o id venha na lista, a função singular
-- recusa e o resultado aparece como `ok=false`.
-- ---------------------------------------------------------------------------
create or replace function cs.fn_oferta_planilha_promover_lote(p_staging_ids bigint[], p_por text)
returns table (ok boolean, offer_code text, acao text, motivo text)
language sql
volatile
security definer
set search_path = cs, public, pg_temp
as $fn$
  select r.ok, r.offer_code, r.acao, r.motivo
    from unnest(p_staging_ids) as ids(staging_id)
   cross join lateral cs.fn_oferta_planilha_promover(ids.staging_id, p_por) as r;
$fn$;

comment on function cs.fn_oferta_planilha_promover_lote(bigint[], text) is
  '0257: promove várias linhas de staging de uma vez (tela de conferência,
   F6) — chama cs.fn_oferta_planilha_promover por id, uma linha de resultado
   por staging_id. Não é transação única: uma linha recusada não derruba as
   demais, e a tela mostra cada resultado.';

revoke all on function cs.fn_oferta_planilha_promover_lote(bigint[], text) from public;
grant execute on function cs.fn_oferta_planilha_promover_lote(bigint[], text) to disparos_app;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA NOMINAL — as funções existem e ainda não promoveram nada (esta
-- migration só DEFINE; promover é ato humano depois, pela tela).
-- ---------------------------------------------------------------------------
do $$
declare v_ja_promovido int;
begin
  select count(*) into v_ja_promovido
    from public.hm_product_catalog where origem_do_dado = 'planilha';
  raise notice '0257: funções de promoção criadas. Linhas já com origem_do_dado=planilha: % (esperado 0 — ninguém promoveu ainda; promoção é ato humano na tela).',
    v_ja_promovido;
end $$;

-- Volta:
--   drop function if exists cs.fn_oferta_planilha_promover_lote(bigint[], text);
--   drop function if exists cs.fn_oferta_planilha_promover(bigint, text);
-- Nada mais depende destas funções nesta leva (B6 as chama; sem elas as rotas
-- de import continuam funcionando para LISTAR staging, só a promoção para).
