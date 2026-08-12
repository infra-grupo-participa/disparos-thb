-- 0199 — as esteiras do AURUM e do HM voltando do erro 500.
--
-- APLICADA EM PRODUCAO em 12/08/2026.
--
-- SINTOMA: /api/hm/kanban e /api/hm/tabela devolviam 500 (corpo vazio) nos boards
-- AURUM e HM. O front mostrava "O servidor não conseguiu responder agora (erro 500)".
--
-- CAUSA RAIZ: cs.fn_hm_produto_da_oferta é SECURITY INVOKER e, no 3º fallback do
-- coalesce, lê public.compras. O app conecta como a role `disparos_app`, que por
-- decisão de hardening NÃO tem SELECT em public.compras (só no schema cs). Como
-- INVOKER executa com o privilégio de QUEM CHAMA, o SELECT estourava:
--     permission denied for table compras (42501)
--     where: SQL function "fn_hm_produto_da_oferta"
--            SQL function "fn_hm_pagamento_do_produto"
--
-- As migrations de 11/08 (0195/0197/0198) passaram a usar fn_hm_pagamento_do_produto
-- dentro de cs.vw_hm_financeiro, lida pelas rotas do kanban e da tabela. Antes disso
-- a função não estava nesse caminho — por isso quebrou só agora, e nos DOIS boards ao
-- mesmo tempo.
--
-- ⚠️ POR QUE PASSOU DESPERCEBIDO (vale para o próximo diagnóstico):
-- pelo SQL editor / MCP a query roda como role privilegiada e FUNCIONA. O erro só
-- aparece pela conexão do app. Foi preciso conectar com a DATABASE_URL real
-- (current_user = disparos_app) para reproduzir. `has_table_privilege` na tabela NÃO
-- cobre tabela lida DENTRO de função INVOKER.
--
-- CORREÇÃO: SECURITY DEFINER (dona = postgres) com search_path fixo. O app segue SEM
-- acesso à tabela crua public.compras — enxerga apenas o retorno da função.
-- Alternativa descartada por decisão do Marcio: GRANT SELECT em public.compras
-- ampliaria a superfície do app para a base bruta de compras.
--
-- search_path fixo é obrigatório em SECURITY DEFINER: sem ele, um search_path hostil
-- poderia resolver `compras` para outra tabela.
--
-- ALCANCE VERIFICADO: fn_hm_produto_da_oferta era a ÚNICA função INVOKER do schema cs
-- tocando public.compras / hm_product_catalog (varredura em pg_proc).

alter function cs.fn_hm_produto_da_oferta(text, text)
  security definer
  set search_path = cs, public, pg_temp;

alter function cs.fn_hm_pagamento_do_produto(text, text)
  security definer
  set search_path = cs, public, pg_temp;

-- EXECUTE explícito para a role do app (não depender do default do PUBLIC).
grant execute on function cs.fn_hm_produto_da_oferta(text, text) to disparos_app;
grant execute on function cs.fn_hm_pagamento_do_produto(text, text) to disparos_app;

comment on function cs.fn_hm_produto_da_oferta(text, text) is
  '0199: SECURITY DEFINER porque lê public.compras no fallback e a role disparos_app nao tem SELECT nessa tabela (hardening). Como INVOKER, derrubava /api/hm/kanban e /api/hm/tabela com 42501 nos boards AURUM e HM.';

-- ── POR QUE A VIEW LÊ public.compras SEM PROBLEMA (e a função não podia) ─────────
-- cs.vw_hm_financeiro também lê public.compras direto (coluna `parcelas_contratadas`).
-- Isso NÃO é bug e não precisa de correção:
--
--   VIEW  -> roda com o privilégio do DONO (postgres), salvo security_invoker=true.
--            vw_hm_financeiro é DEFINER padrão, dona postgres => a leitura é legítima.
--   FUNÇÃO -> é INVOKER por PADRÃO, ou seja, roda com o privilégio de QUEM CHAMA.
--            Era exatamente esse o defeito corrigido acima.
--
-- Verificado como disparos_app: `select count(parcelas_contratadas) from
-- cs.vw_hm_financeiro` retorna normalmente, enquanto `select 1 from public.compras`
-- dá 42501. A assimetria é a regra do Postgres, não sorte do planner.
