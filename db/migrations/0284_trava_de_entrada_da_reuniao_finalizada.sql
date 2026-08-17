-- =====================================================================
-- 0284_trava_de_entrada_da_reuniao_finalizada
--
-- D2 + D4 (decisões do Marcio): "Reunião Finalizada" (hm_reuniao_finalizada)
-- passa a ter trava de ENTRADA — igual à trava já existente do checklist de
-- "Ativação Realizada" (cs.fn_hm_pode_finalizar/checklistPendente,
-- lib/services/hm.ts): guarda a PORTA da coluna, não prende o card depois
-- que ele já está lá. D4 é explícita: os 42 cards que HOJE já estão em
-- "Reunião Finalizada" seguem livres — esta função só é chamada no momento
-- da ENTRADA (moverEstagioHm, B2), nunca varre o board existente.
--
-- Regra (exige as DUAS partes):
--   (a) reuniao_resultado preenchido — a reunião de fato aconteceu e foi
--       registrada (esse campo já existe, migration 0096).
--   (b) desfecho comercial, QUALQUER um destes três:
--         · intencao_pagamento in ('vai_pagar', 'indeciso')   — 0281
--         · acordo não-vazio (texto livre, já existente, 0056)
--         · já existe pagamento registrado para este card (cs.hm_pagamentos)
--       intencao_pagamento = 'nao_vai_pagar' NÃO libera sozinho — mas não
--       IMPEDE que `acordo` ou pagamento já lançado liberem por outra via
--       (a pessoa pode ter dito "não vou pagar" numa reunião e o comercial
--       fechado um acordo diferente depois, por exemplo).
--
-- Retorna jsonb `{ok: bool, faltando: [...]}` — mesmo contrato de
-- checklistPendente (lib/services/hm.ts): lista vazia quando ok=true, ou os
-- rótulos do que falta para a tela explicar em vez de recusar sem dizer o
-- quê (mesmo padrão do erro `checklist_incompleto` que já existe no board).
--
-- `security definer` + `search_path` fixo, MESMO padrão das funções irmãs
-- do schema (cs.fn_hm_pode_finalizar, 0221; cs.fn_hm_prorata) — conferido
-- no corpo delas antes de escrever esta.
--
-- Aditiva e idempotente.
-- =====================================================================

create or replace function cs.fn_hm_pode_finalizar_reuniao(p_comprador_id uuid, p_produto text default 'HM')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_reuniao_resultado text;
  v_intencao          text;
  v_acordo            text;
  v_faltando          text[] := '{}';
  v_tem_pagamento     boolean;
begin
  -- Card do produto pedido — mesmo desempate do resto do módulo (produto
  -- explícito, order by criado_em asc, limit 1): sem isso, quem tem card no
  -- HM e no AURUM (15 pessoas hoje) avaliaria a trava contra o card errado.
  select ch.reuniao_resultado, ch.intencao_pagamento, ch.acordo
    into v_reuniao_resultado, v_intencao, v_acordo
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador_id
     and coalesce(ch.produto, 'HM') = coalesce(p_produto, 'HM')
   order by ch.criado_em asc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'faltando', to_jsonb(array['card não encontrado']::text[]));
  end if;

  if v_reuniao_resultado is null or btrim(v_reuniao_resultado) = '' then
    v_faltando := array_append(v_faltando, 'resultado da reunião');
  end if;

  v_tem_pagamento := exists (
    select 1 from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, coalesce(p_produto, 'HM'))
  );

  if not (
    v_intencao in ('vai_pagar', 'indeciso')
    or (v_acordo is not null and btrim(v_acordo) <> '')
    or v_tem_pagamento
  ) then
    v_faltando := array_append(v_faltando, 'desfecho comercial (intenção de pagamento, acordo ou pagamento registrado)');
  end if;

  return jsonb_build_object('ok', array_length(v_faltando, 1) is null, 'faltando', to_jsonb(v_faltando));
end$fn$;

comment on function cs.fn_hm_pode_finalizar_reuniao(uuid, text) is
  '0284: trava de ENTRADA em hm_reuniao_finalizada (D2/D4) — exige reuniao_resultado preenchido E desfecho comercial (intencao_pagamento vai_pagar/indeciso OU acordo preenchido OU pagamento ja lancado). nao_vai_pagar sozinho NAO libera. So de entrada: card ja na etapa segue livre (D4, os 42 cards historicos nao sao tocados).';

grant execute on function cs.fn_hm_pode_finalizar_reuniao(uuid, text) to disparos_app;
