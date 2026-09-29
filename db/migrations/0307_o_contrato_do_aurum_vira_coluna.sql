-- 0307: o contrato do AURUM vira coluna materializada
--
-- CONTEXTO — o que a 0303/0304 tentaram e por que caíram
--
-- Quem comprou AURUM na Clínica de Goiânia tem contrato PRÓPRIO (R$ 13.000),
-- não o pacote de SP (R$ 59.000 − entrada). Sebastião aparecia devendo ~R$ 46k
-- quando devia ~R$ 9,5k. A 0303/0304 corrigiram a conta lendo `public.compras`
-- + `hm_product_catalog` DENTRO de `cs.fn_aurum_saldo`.
--
-- 🔴 Isso derrubou `/api/hm/kanban` em TODOS os portais (HTTP 500). A função é
-- chamada por `cs.vw_aurum_saldo`, que entra no board como LATERAL — ou seja,
-- roda UMA VEZ POR CARD. Dois joins novos por card estouraram o tempo. A 0305
-- reverteu tudo.
--
-- MEDIÇÃO ANTES DE APLICAR (o passo que faltou nas duas vezes anteriores):
--   EXPLAIN ANALYZE do LATERAL aurum sobre 100 cards, com a função na forma
--   ORIGINAL (já revertida):  Planning 650ms · Execution 2.288ms.
--   A rota já operava perto do limite — não havia folga para consulta nova.
--
--   População afetada: 11 pessoas têm oferta de saldo com `valor_tabela` próprio.
--
-- DECISÃO: não calcular por card para resolver 11 casos. O contrato vira COLUNA
-- em `cs.contatos_hm`, preenchida uma vez; a função apenas LÊ essa coluna
-- (uma linha, pela PK do card). Custo por card: idêntico ao de antes.
--
-- MEDIÇÃO DEPOIS: mesmo EXPLAIN ANALYZE → Execution 1.356ms, plano idêntico
-- (Index Scan + Memoize em toda a cadeia, nenhum passo novo).
--
-- ⚠️ Esta migration faz apenas o BACKFILL. Pagamento futuro de contrato próprio
-- ainda não preenche a coluna sozinho — ver o TODO no fim do arquivo.

begin;

-- ── 1. A coluna ─────────────────────────────────────────────────────────────
alter table cs.contatos_hm
  add column if not exists contrato_aurum numeric(12,2);

comment on column cs.contatos_hm.contrato_aurum is
  '0307: valor do contrato AURUM quando a pessoa comprou por uma oferta com valor_tabela PRÓPRIO (ex.: Clínica de Goiânia, R$ 13.000) em vez do pacote do ETHB SP. NULL = usa a régua padrão de cs.aurum_parametros (pacote_cheio − entrada). Materializada de propósito: cs.fn_aurum_saldo roda por card no board e não pode consultar public.compras/hm_product_catalog em tempo de leitura — ver o cabeçalho desta migration.';

-- ── 2. Backfill ─────────────────────────────────────────────────────────────
-- Fonte: a oferta de SALDO do AURUM que a pessoa comprou e teve aprovada,
-- quando essa oferta tem valor_tabela próprio no catálogo.
--
-- ⚠️ O critério aplicado originalmente aqui era `entrada_do_programa = true`, e
-- estava INVERTIDO — pegava a taxa de inscrição do evento (R$ 1.000) em vez do
-- contrato. Corrigido pela 0309, que também recompôs os cards afetados. Este
-- arquivo já traz o critério certo; ver o cabeçalho da 0309 para os dados que
-- provam a inversão.
update cs.contatos_hm ch
   set contrato_aurum = src.valor_tabela
  from (
    select distinct on (c.comprador_id)
           c.comprador_id,
           cat.valor_tabela
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo::text
     where cat.papel = 'saldo'
       and cat.valor_tabela is not null
       and cs.fn_hm_pagamento_do_produto(cat.offer_code, 'AURUM')
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
     order by c.comprador_id, coalesce(c.data_aprovacao, c.data_compra) desc
  ) src
 where ch.comprador_id = src.comprador_id
   and coalesce(ch.produto, 'HM') = 'AURUM'
   and ch.contrato_aurum is distinct from src.valor_tabela;

-- ── 3. A função LÊ a coluna ─────────────────────────────────────────────────
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
  ), contrato as (
    -- 0307: LE a coluna materializada. Indexada pela PK do card, uma linha.
    -- Nao consulta compras nem catalogo aqui — foi isso que derrubou a 0304.
    select ch.contrato_aurum as valor
      from cs.contatos_hm ch
     where ch.comprador_id = p_comprador
       and coalesce(ch.produto,'HM') = 'AURUM'
       and ch.contrato_aurum is not null
     limit 1
  )
  select case
           when (select excecao from a) then null::numeric
           -- Contrato proprio: falta o que DELE falta, sem a entrada de SP.
           when (select valor from contrato) is not null then
             greatest(round(
               ( (select valor from contrato)
               - coalesce((select credito from a), 0::numeric)
               - (select valor from pago) ), 2), 0::numeric)
           else
             greatest(round(
               ( (select valor from cs.aurum_parametros where chave = 'pacote_cheio')
               - (select valor from cs.aurum_parametros where chave = 'entrada')
               - coalesce((select credito from a), 0::numeric)
               - (select valor from pago) ), 2), 0::numeric)
         end;
$function$;

-- ── 4. Travas — abortam a migration se o efeito não for o esperado ──────────
do $$
declare
  v_sebastiao numeric;
  v_vanda     numeric;
  v_marcados  int;
begin
  select count(*) into v_marcados
    from cs.contatos_hm where contrato_aurum is not null;

  if v_marcados = 0 then
    raise exception '0307: backfill nao marcou ninguem — o criterio de oferta mudou. Abortando.';
  end if;

  -- Caso que motivou a correção: contrato de 13k, não pacote de SP.
  select round(f.saldo_a_perseguir) into v_sebastiao
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
    join cs.vw_hm_financeiro f on f.contato_hm_id = ch.id
   where ch.produto = 'AURUM' and cp.nome ilike 'Sebastiao Jose da Silva%';

  if v_sebastiao is null or v_sebastiao > 15000 then
    raise exception '0307: saldo do contrato proprio nao caiu (valor=%). Esperado ~9.528. Abortando.', v_sebastiao;
  end if;

  -- CONTROLE: quem é do ETHB SP não pode se mexer.
  select round(f.saldo_a_perseguir) into v_vanda
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
    join cs.vw_hm_financeiro f on f.contato_hm_id = ch.id
   where ch.produto = 'AURUM' and cp.nome ilike 'Vanda Amorim%';

  if v_vanda is distinct from 59000 then
    raise exception '0307: o controle do ETHB SP mudou (Vanda=%). Esperado 59.000. Abortando.', v_vanda;
  end if;

  raise notice '0307: % card(s) com contrato proprio. Contrato proprio=% · controle ETHB SP=%.',
    v_marcados, v_sebastiao, v_vanda;
end $$;

commit;

-- ── Continuação ─────────────────────────────────────────────────────────────
-- Este backfill congela o estado de hoje: venda NOVA por oferta de contrato
-- próprio nasceria com contrato_aurum NULL e cairia na régua de SP. Resolvido
-- pela 0308 (cs.fn_hm_carimbar_contrato_aurum, chamada em cs.fn_tag_hm_origem)
-- com o critério corrigido pela 0309. Não é trigger em public.compras de
-- propósito: aquela tabela é caminho quente de ingestão do webhook.
