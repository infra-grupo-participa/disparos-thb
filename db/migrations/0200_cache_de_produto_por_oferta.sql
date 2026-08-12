-- 0200 — memoiza a resolução oferta -> produto.
--
-- ── O PROBLEMA ──────────────────────────────────────────────────────────────────
-- cs.fn_hm_pagamento_do_produto é chamada em SEIS pontos de cs.vw_hm_financeiro
-- (pago_no_ciclo, ultimo_pagamento_em, parcelas_pagas, valor_parcela, situacao e o
-- lateral `ab`), e cada chamada dispara cs.fn_hm_produto_da_oferta, que faz até 3
-- subqueries — a última varrendo public.compras.
--
-- MEDIDO: uma varredura de cs.vw_hm_financeiro custava 2.414 varreduras de
-- cs.hm_pagamentos. E o trabalho é quase todo redundante: são 394 pagamentos, mas só
-- 31 ofertas DISTINTAS (que resolvem para apenas 2 produtos: 30 HM + 1 AURUM).
--
-- ── POR QUE DÁ PARA CACHEAR ─────────────────────────────────────────────────────
-- A relação oferta -> produto é ESTÁVEL: uma oferta pertence a um produto e não muda
-- de dono. O que muda é o CONJUNTO de ofertas — entram ofertas novas todo mês
-- (9 em ago/26, 25 em jul/26). Por isso cache estático não serve: desatualiza.
--
-- ── A SOLUÇÃO: cache preenchido SOB DEMANDA ─────────────────────────────────────
-- A função passa a olhar o cache primeiro. Se não achar, resolve pela regra antiga
-- (inalterada) e GRAVA. Oferta nova entra sozinha na primeira leitura — sem cron,
-- sem refresh manual, sem risco de ficar velho.
--
-- MEDIDO em transação revertida, no padrão exato que a view usa:
--     resolução pela função .... 140 ms
--     resolução pelo cache ......  17 ms   (8x)
--
-- ── SEGURANÇA ───────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + search_path fixo, como a 0199 — o cache lê public.compras no
-- fallback e a role disparos_app não tem SELECT nessa tabela. A role recebe só
-- EXECUTE: quem escreve no cache é a função (dona postgres), nunca o app.

create table if not exists cs.hm_produto_por_oferta (
  oferta_codigo text primary key,
  produto       text not null,
  resolvido_em  timestamptz not null default now()
);

comment on table cs.hm_produto_por_oferta is
  '0200: cache de oferta -> produto, preenchido sob demanda por cs.fn_hm_produto_da_oferta. Evita reresolver a mesma oferta milhares de vezes por consulta da vw_hm_financeiro. Pode ser esvaziado com segurança (delete from) — reenche sozinho na proxima leitura.';

revoke insert, update, delete on cs.hm_produto_por_oferta from disparos_app;
grant select on cs.hm_produto_por_oferta to disparos_app;

-- A regra de resolução ORIGINAL, isolada. Idêntica à da 0199 — só saiu de lugar,
-- para o cache poder chamá-la no miss sem duplicar a lógica.
create or replace function cs.fn_hm_produto_da_oferta_calc(p_oferta text, p_produto_id text default null)
returns text
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $function$
  select coalesce(
    (select o.produto from cs.hm_origem_por_oferta o
      where o.oferta_codigo = p_oferta and o.produto is not null
      order by o.vale_de desc nulls last limit 1),
    (select m.produto from cs.hm_produto_hotmart m where m.produto_id = p_produto_id),
    (select m.produto from public.compras c
       join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
      where c.oferta_codigo = p_oferta
      order by coalesce(c.data_aprovacao, c.data_compra) desc nulls last limit 1),
    'HM');
$function$;

comment on function cs.fn_hm_produto_da_oferta_calc(text, text) is
  '0200: a regra de resolucao oferta -> produto (as 3 fontes, na ordem). Chamada so no MISS do cache. Nao usar direto em query de listagem: use cs.fn_hm_produto_da_oferta, que memoiza.';

-- A função pública passa a ser: cache -> (miss) calcula e grava.
--
-- VOLATILE, não STABLE: ela ESCREVE no cache. Marcar STABLE mentindo sobre isso faz
-- o planner assumir que não há efeito colateral — e um INSERT dentro de função
-- declarada STABLE é erro em tempo de execução no Postgres.
--
-- O p_produto_id NÃO entra na chave do cache de propósito: ele é só uma dica extra
-- da 2ª fonte, e a chave real de negócio é a oferta. Quando ele vem preenchido,
-- pula-se o cache para não gravar uma resolução enviesada pela dica.
-- ⚠️ O `DEFAULT NULL` do 2º parâmetro é OBRIGATÓRIO: a função original o tinha e há
-- chamadores que passam só a oferta. `create or replace` sem o default falha com
-- 42P13 ("cannot remove parameter defaults from existing function") — que foi
-- exatamente o que aconteceu na 1ª tentativa desta migration.
create or replace function cs.fn_hm_produto_da_oferta(p_oferta text, p_produto_id text default null)
returns text
language plpgsql
volatile
security definer
set search_path = cs, public, pg_temp
as $function$
declare
  v_produto text;
begin
  if p_oferta is null then
    return cs.fn_hm_produto_da_oferta_calc(p_oferta, p_produto_id);
  end if;

  -- Com dica de produto_id, resolve sem cache (a dica pode mudar a resposta).
  if p_produto_id is not null then
    return cs.fn_hm_produto_da_oferta_calc(p_oferta, p_produto_id);
  end if;

  select produto into v_produto
    from cs.hm_produto_por_oferta where oferta_codigo = p_oferta;
  if found then
    return v_produto;
  end if;

  v_produto := cs.fn_hm_produto_da_oferta_calc(p_oferta, null);

  -- Gravar o cache é OPORTUNISTA: se falhar (concorrência, read-only, permissão),
  -- a resposta já está correta e a consulta não pode cair por causa disso.
  begin
    insert into cs.hm_produto_por_oferta (oferta_codigo, produto)
    values (p_oferta, v_produto)
    on conflict (oferta_codigo) do nothing;
  exception when others then
    null;
  end;

  return v_produto;
end$function$;

comment on function cs.fn_hm_produto_da_oferta(text, text) is
  '0200: resolve oferta -> produto pelo cache cs.hm_produto_por_oferta, preenchendo sob demanda no miss (regra em fn_hm_produto_da_oferta_calc). VOLATILE porque escreve no cache. SECURITY DEFINER desde a 0199: le public.compras no fallback e disparos_app nao tem SELECT nessa tabela.';

grant execute on function cs.fn_hm_produto_da_oferta(text, text) to disparos_app;
grant execute on function cs.fn_hm_produto_da_oferta_calc(text, text) to disparos_app;

-- Aquece com o que já se conhece hoje (as ofertas que têm pagamento).
insert into cs.hm_produto_por_oferta (oferta_codigo, produto)
select distinct p.oferta_codigo, cs.fn_hm_produto_da_oferta_calc(p.oferta_codigo, null)
  from cs.hm_pagamentos p
 where p.oferta_codigo is not null
on conflict (oferta_codigo) do nothing;

-- ── INVALIDAÇÃO ─────────────────────────────────────────────────────────────────
-- As duas fontes de catálogo são as únicas que podem MUDAR a resposta de uma oferta
-- já cacheada (o 3º fallback, public.compras, só acrescenta oferta nova — e essa
-- entra pelo miss). Mexeu no catálogo, o cache daquela oferta cai e se refaz sozinho.
create or replace function cs.fn_hm_invalida_cache_oferta()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $function$
begin
  if tg_table_name = 'hm_origem_por_oferta' then
    delete from cs.hm_produto_por_oferta
     where oferta_codigo in (coalesce(new.oferta_codigo, old.oferta_codigo));
  else
    -- hm_produto_hotmart: mapeia produto_id -> produto, não a oferta. Não dá para
    -- saber quais ofertas dependiam dele; limpar tudo é barato (dezenas de linhas)
    -- e o cache se refaz na primeira leitura.
    delete from cs.hm_produto_por_oferta;
  end if;
  return null;
end$function$;

drop trigger if exists trg_invalida_cache_oferta on cs.hm_origem_por_oferta;
create trigger trg_invalida_cache_oferta
  after insert or update or delete on cs.hm_origem_por_oferta
  for each row execute function cs.fn_hm_invalida_cache_oferta();

drop trigger if exists trg_invalida_cache_produto on cs.hm_produto_hotmart;
create trigger trg_invalida_cache_produto
  after insert or update or delete on cs.hm_produto_hotmart
  for each statement execute function cs.fn_hm_invalida_cache_oferta();
