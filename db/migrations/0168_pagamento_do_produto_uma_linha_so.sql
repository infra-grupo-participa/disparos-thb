-- 0168_pagamento_do_produto_uma_linha_so.sql
-- INCIDENTE (10/08/2026, ~22h): o board do HM parou de carregar e a tela dizia
-- "Sem conexão com o servidor. Verifique a rede e tente de novo." A rede estava
-- boa: `/api/hm/kanban` respondia, mas com 500. A mensagem enganava porque o
-- `catch` do carregar() em app/hm/kanban/page.tsx:373 cobre TAMBÉM o
-- `r.json()` — resposta que não é JSON cai como se fosse falha de rede.
--
-- CAUSA — regressão da 0167. `cs.fn_hm_pagamento_do_produto` descobria o produto
-- da oferta com um subquery ESCALAR:
--
--     (select o.produto from cs.hm_origem_por_oferta o where o.oferta_codigo = p_oferta)
--
-- Isso valia enquanto a tabela tinha PRIMARY KEY (oferta_codigo). A 0167 tirou a
-- PK para dar duas janelas à `rlgjsrul` — e o subquery passou a devolver duas
-- linhas: `ERROR 21000: more than one row returned by a subquery used as an
-- expression`. A função é usada em 6 pontos de `cs.vw_hm_financeiro`, então a
-- view inteira estourava, e com ela o board, a tabela e os relatórios.
--
-- Por que não apareceu na verificação da 0167: eu blindei `fn_hm_card_da_oferta`
-- (o consumidor que eu conhecia) e tentei listar os demais com um
-- `pg_get_functiondef` sobre todas as funções — a consulta falhou por incluir
-- agregados ("array_agg is an aggregate function") e eu segui sem repetí-la. Os
-- testes que rodei (contagem de linhas das views, teste seco das janelas,
-- reexecução de fn_tag_hm_origem) não tocavam esta função: `count(*)` não avalia
-- as colunas que a chamam. Lição em [[0167]]: ao trocar a cardinalidade de uma
-- tabela, listar TODOS os consumidores é parte da migration, não da revisão.
--
-- CORREÇÃO: o produto é o mesmo em todas as janelas de uma oferta — basta ler
-- uma linha, com desempate determinístico (a janela mais recente), igual ao que
-- a 0167 fez em `fn_hm_card_da_oferta`.
--
-- Volatilidade mantida em IMMUTABLE, como estava. É incorreto (a função lê
-- tabela), mas mudar para STABLE agora invalidaria os planos e o índice
-- funcional que dependem dela — dívida registrada, não paga no meio do
-- incidente.
create or replace function cs.fn_hm_pagamento_do_produto(p_oferta text, p_produto text)
 returns boolean
 language sql
 immutable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select coalesce(
    (select o.produto from cs.hm_origem_por_oferta o
      where o.oferta_codigo = p_oferta
      order by o.vale_de desc nulls last
      limit 1),
    'HM'
  ) = coalesce(p_produto, 'HM');
$function$;
