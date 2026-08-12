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

-- ── PENDÊNCIA CONHECIDA, NÃO CORRIGIDA AQUI ─────────────────────────────────────
-- cs.vw_hm_financeiro lê public.compras DIRETAMENTE na coluna `parcelas_contratadas`
-- (subquery "select max(c.parcelas) from compras c ..."). Hoje não estoura porque o
-- planner poda esse ramo nas consultas do kanban/tabela, mas é a MESMA classe de bug:
-- se o plano mudar, o 500 volta. Corrigir passa por encapsular essa leitura numa
-- função SECURITY DEFINER (ou numa view própria) — mexe na régua financeira e merece
-- migration própria, com conferência dos números antes e depois.
