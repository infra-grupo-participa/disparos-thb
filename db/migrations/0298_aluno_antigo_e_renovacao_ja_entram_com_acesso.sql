-- =====================================================================
-- 0298_aluno_antigo_e_renovacao_ja_entram_com_acesso
--
-- D1 (decisão do Marcio, 17/08): "Pessoas que são de renovação ou que já
-- são alunos antigos [...] a gente já tem que deixar acertado que ela já
-- tem acesso ao Search, à comunidade do THB e grupo de informes." Estende a
-- auto-marcação da 0213 (que hoje só olha TAGS_ALUNO_ANTIGO — 'Aluno THB' /
-- 'Aluno Aurum') para cobrir também quem entra por RENOVAÇÃO, mesmo sem
-- nenhuma dessas tags (6 das 13 fichas com a flag hoje não têm tag de aluno
-- antigo — ver levantamento do pedido).
--
-- NÃO marca ativ_gps: esse é o item que fica pendente (D2) para todo mundo,
-- novo ou antigo — ver 0297.
--
-- ── O CRITÉRIO DE "É RENOVAÇÃO" ──────────────────────────────────────────
-- Extraído de `pg_get_viewdef('cs.contatos_hm_kanban')` pelo Marcio (17/08):
-- a view calcula `renovacao` com este LATERAL —
--
--   LEFT JOIN LATERAL (
--     SELECT p.oferta_codigo
--       FROM cs.hm_pagamentos p
--       JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
--      WHERE p.comprador_id = ch.comprador_id
--        AND cat.papel = 'renovacao'::text
--        AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
--      ORDER BY p.pago_em DESC NULLS LAST, p.valor DESC, p.id DESC
--      LIMIT 1
--   ) rn ON true
--   -- renovacao := rn.oferta_codigo IS NOT NULL
--
-- É renovação quem tem pagamento lançado numa oferta com `papel='renovacao'`
-- no catálogo, do MESMO produto do card. Dentro do trigger, o predicado
-- equivalente (ancorado em `new.comprador_id`/`new.produto`, que é o que a
-- linha da TABELA tem — a view não é acessível aqui) é um `exists` puro:
-- mesma leitura, sem o `order by`/`limit 1` (que na view só serve para trazer
-- 1 linha de `oferta_codigo`; para o booleano "existe alguma", o exists basta
-- e é a MESMA resposta). Fonte única preservada — nenhuma segunda definição.
-- =====================================================================

create or replace function cs.fn_hm_dono_por_aba()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_aba_nova   text;
  v_aba_antiga text;
  -- 0298 (D1): mesmo critério de "é renovação" que cs.contatos_hm_kanban usa
  -- na coluna `renovacao` (view, LATERAL contra cs.hm_pagamentos + catálogo
  -- por papel='renovacao' do MESMO produto — ver cabeçalho desta migration
  -- para a leitura completa extraída de pg_get_viewdef). NÃO é uma segunda
  -- definição: é o mesmo exists, ancorado em new.comprador_id/new.produto.
  v_e_renovacao boolean;
begin
  select aba into v_aba_nova from cs.estagios where id = new.estagio_id;
  select aba into v_aba_antiga from cs.estagios where id = old.estagio_id;

  if v_aba_nova = 'ativacao' and v_aba_antiga is distinct from 'ativacao' then
    new.responsavel_ativacao_id := coalesce(new.responsavel_ativacao_id, new.responsavel_id);

    -- 0298 (D1): mesmo exists que sustenta cs.contatos_hm_kanban.renovacao —
    -- pagamento lançado numa oferta com papel='renovacao' no catálogo, do
    -- MESMO produto do card (fn_hm_pagamento_do_produto). Calculado só quando
    -- precisa (a tag já pode ter resolvido o `or` abaixo sem chegar aqui —
    -- mas o Postgres não faz short-circuit de `or` fora de CASE/coalesce,
    -- então roda sempre; é um exists barato, indexado por comprador_id).
    v_e_renovacao := exists (
      select 1
        from cs.hm_pagamentos p
        join public.hm_product_catalog cat on cat.offer_code = p.oferta_codigo
       where p.comprador_id = new.comprador_id
         and cat.papel = 'renovacao'
         and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, new.produto)
    );

    -- 0298: mesmo critério de "zero feito" da 0213 — só age se os 3 estão
    -- TODOS false, para não sobrescrever marcação parcial feita à mão (ex.:
    -- Searchie liberado manualmente antes de reentrar na Ativação). Card com
    -- 1 ou 2 já marcados fica de fora de propósito — quem fez a marcação
    -- parcial decide o resto (mesma guarda da 0213, preservada).
    if (new.tags && array['Aluno THB','Aluno Aurum'] or v_e_renovacao)
       and coalesce(new.ativ_searchie, false) = false
       and coalesce(new.ativ_comunidade, false) = false
       and coalesce(new.ativ_grupo, false) = false
    then
      new.ativ_searchie  := true;
      new.ativ_comunidade := true;
      new.ativ_grupo      := true;

      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (new.id, 'sistema',
              'Aluno antigo/renovação — acessos Searchie/comunidade/grupo marcados automaticamente (GPS segue pendente)',
              'sistema');
    end if;
  end if;

  if v_aba_nova = 'comercial' and v_aba_antiga is distinct from 'comercial' then
    new.responsavel_comercial_id := coalesce(new.responsavel_comercial_id, new.responsavel_id);
  end if;

  return new;
end$function$;

comment on function cs.fn_hm_dono_por_aba() is
  '0212+0213+0298: ao ENTRAR numa aba, carimba responsavel_{aba}_id (se vazio) e, na entrada em ativacao com tag de aluno antigo (THB/Aurum) OU renovacao (mesmo criterio de cs.contatos_hm_kanban.renovacao, 0269) e os 3 acessos ainda zerados, auto-marca ativ_searchie/comunidade/grupo (NUNCA ativ_gps, o item que fica pendente para todos, D2/0297; NUNCA ativ_pesquisa, que guarda outro gate). Tags espelham TAGS_ALUNO_ANTIGO em lib/papeis.ts. Zero retroatividade no cadastro — so vale para TRANSICOES futuras (os 61 ja hoje na Ativacao sao cobertos a parte pela 0299).';

-- ── Conferência ──────────────────────────────────────────────────────────────
do $$
declare
  v_trigger_existe int;
begin
  select count(*) into v_trigger_existe
    from pg_trigger
   where tgname = 'trg_hm_a_dono_por_aba' and tgrelid = 'cs.contatos_hm'::regclass and not tgisinternal;
  if v_trigger_existe <> 1 then
    raise exception '0298: trg_hm_a_dono_por_aba (0212) não encontrada — a função foi substituída sem o trigger que a aciona.';
  end if;

  raise notice '0298: fn_hm_dono_por_aba estendida com renovacao (D1). ativ_gps preservado fora do escopo (D2/0297). Zero UPDATE retroativo (ver 0299).';
end $$;
