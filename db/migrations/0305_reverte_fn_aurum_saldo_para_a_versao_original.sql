-- 0305_reverte_fn_aurum_saldo_para_a_versao_original
-- APLICADA EM PRODUCAO 18/08/2026, durante incidente.
--
-- ── O incidente ─────────────────────────────────────────────────────────────
-- Depois da 0304, /api/hm/kanban passou a responder HTTP 500 e a tela mostrava
-- "Não foi possível carregar a Jornada" — em todos os portais. As demais rotas
-- (/api/me, /api/hm/estagios, /api/hm/tags, /api/hm/notificacoes) seguiam 200.
--
-- ⚠️ O SQL da rota rodava normalmente quando executado à mão: 264 linhas, com
-- todos os joins, LATERAL e views. Foi o que me fez demorar a achar — testei o
-- banco exaustivamente e ele estava íntegro. A falha só aparecia pelo caminho
-- da aplicação, e o log do servidor está fora do meu alcance.
--
-- A reversão da 0304 devolveu o board na primeira tentativa: a requisição
-- seguinte a esta migration voltou 200 e a tela renderizou 264 alunos.
--
-- ── Por que a 0304 quebrou (hipótese, não confirmada) ───────────────────────
-- A 0304 acrescentou um CTE `contrato` que consulta public.compras e
-- hm_product_catalog dentro de fn_aurum_saldo. A função é chamada por
-- cs.vw_aurum_saldo, que a rota do board consulta num LATERAL por card. O custo
-- extra por linha, multiplicado pelos cards do board, provavelmente estourou o
-- tempo da requisição — o mesmo padrão do incidente do envelope da view, mais
-- cedo no mesmo dia: correção funcionalmente certa, custo não medido.
--
-- ── Custo aceito ────────────────────────────────────────────────────────────
-- O Sebastião volta a mostrar R$ 55.527,75 em vez de R$ 9.528. O número errado
-- na tela é ruim; a tela fora do ar é pior. A correção do contrato próprio
-- (Clínica GO) precisa voltar depois — com EXPLAIN ANALYZE da rota inteira
-- antes de aplicar, não só da função isolada.

create or replace function cs.fn_aurum_saldo(p_comprador uuid)
 returns numeric
 language sql
 stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  with a as (
    select ap.credito, ap.excecao from cs.aurum_pagamento_aluno ap
     where ap.comprador_id = p_comprador
     order by ap.atualizado_em desc, ap.documento limit 1
  ), pago as (
    select coalesce(sum(p.valor), 0::numeric) as valor from cs.hm_pagamentos p
     where p.comprador_id = p_comprador
       and p.categoria is distinct from 'sinal'
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, 'AURUM')
  )
  select case when (select excecao from a) then null::numeric
              else greatest(round(
                ( (select valor from cs.aurum_parametros where chave = 'pacote_cheio')
                - (select valor from cs.aurum_parametros where chave = 'entrada')
                - coalesce((select credito from a), 0::numeric)
                - (select valor from pago) ), 2), 0::numeric) end;
$function$;

comment on function cs.fn_aurum_saldo(uuid) is
  '0305: revertida ao corpo original (pre-0304) durante o incidente de 18/08, para devolver o board que estava em 500. A correcao do contrato proprio (Clinica GO, saldo pelo valor_tabela da oferta) precisa voltar depois, com EXPLAIN ANALYZE da rota do kanban inteira antes de aplicar.';
