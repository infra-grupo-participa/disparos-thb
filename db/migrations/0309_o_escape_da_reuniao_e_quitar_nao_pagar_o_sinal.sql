-- =====================================================================
-- 0309_o_escape_da_reuniao_e_quitar_nao_pagar_o_sinal
--
-- ⚠️ APLICADA EM PRODUCAO 21/08/2026 — este arquivo versiona o que JÁ RODA.
--    Conferido contra pg_get_functiondef após aplicar.
--
-- ── O achado (fable-orchestrator, no veredito da 0307/0308) ───────────────
-- O escape "fato consumado" da 0284/0308 dizia: quem JÁ TEM pagamento
-- registrado não precisa declarar trilha [A] nem [B]. Parecia estreito.
-- Não era: `cs.fn_hm_pagamento_do_produto` casa oferta↔produto mas **NÃO
-- filtra categoria**, e 293 das 433 linhas de cs.hm_pagamentos são SINAL.
-- Medido: **299 de 305 cards (98%)** satisfaziam o escape — ou seja, para
-- quase toda a esteira a trava de SERVIDOR continuava exigindo só
-- reuniao_resultado, igual à 0284. Quem obrigava a trilha A/B nos movimentos
-- novos era só o modal da UI (que não tem botão de pular).
--
-- 🔑 "Tem pagamento" ≠ "não deve nada". Quem pagou o SINAL é exatamente
-- de quem o financeiro precisa cobrar o saldo — dar escape a ele é dar
-- escape a quase todo mundo que a feature veio pegar.
--
-- ── A decisão (Marcio, 21/08) ────────────────────────────────────────────
-- O escape passa a ser QUITOU: saldo <= 1 (a folga de R$ 1 absorve os 8
-- cards com resíduo de centavos por arredondamento, já registrados na
-- auditoria de 20/07 como poluição de "devendo"). Quem tem saldo entra na
-- regra e precisa de trilha [A] ou [B].
--
-- Efeito medido nas 305 fichas reais:
--   antes (0308):  161 liberadas / 144 barradas
--   depois (0309):  53 liberadas / 252 barradas   ← 218 cards perdem o escape
--
-- ⚠️ Continua sendo trava de ENTRADA (moverEstagioHm): os cards que já estão
-- em hm_reuniao_finalizada seguem livres. Sem backfill, sem retroatividade —
-- mesmo princípio da 0284/0306/0308.
--
-- ── Por que `vw_fin_contas_receber` e NÃO `vw_hm_financeiro` ─────────────
-- As duas dão o saldo. Medido no MESMO conjunto (20 cards, explain analyze):
--   via cs.vw_fin_contas_receber ... 4.015 buffers  (~200/chamada)
--   via cs.vw_hm_financeiro ........ 7.845 buffers  (quase 2x)
-- A vw_hm_financeiro invoca cs.fn_hm_prorata em 16 SubPlans (20 ms / 4.071
-- buffers por chamada — gargalo herdado, ver a nota da 0304). Filtrando
-- vw_fin_contas_receber por contato_hm_id, os SubPlans de prorata aparecem
-- como `never executed` no plano. Mesma resposta, metade do custo.
--
-- ⚠️ E NÃO usa `quitado`/`status_financeiro` como fonte: **18 cards estão
-- marcados quitado COM saldo > 0 (R$ 231.637)** — o CASE da view testa
-- quitado_em antes de checar saldo (bug conhecido, registrado 19/08). Usar a
-- flag daria escape a 18 pessoas que devem R$ 231 mil. Fato monetário vence
-- rótulo de status.
--
-- ── Custo da trava (explain analyze, buffers) ────────────────────────────
--   0308 (escape por "tem pagamento") ..... ~2,7 ms /   344 buffers
--   0309 (escape por saldo quitado) ....... ~2,9 ms /   200 buffers/chamada
--     (medido em lote: 20 cards = 58,9 ms / 4.015 buffers)
-- Roda 1x por movimento para hm_reuniao_finalizada — unidades por dia.
-- Sem índice novo: cs.contatos_hm tem 305 linhas e o Seq Scan é a escolha
-- certa do planner nesse tamanho.
--
-- ── Reversão ─────────────────────────────────────────────────────────────
-- Degrau 1, sem deploy: reaplicar o corpo da 0308 (escape por v_tem_pagamento).
-- Nenhuma coluna muda aqui — esta migration é só a função.
-- =====================================================================

create or replace function cs.fn_hm_pode_finalizar_reuniao(p_comprador_id uuid, p_produto text default 'HM'::text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_reuniao_resultado   text;
  v_intencao             text;
  v_pagamento_previsto   date;
  v_pagamento_meio       text;
  v_intencao_obs         text;
  v_reuniao_motivo_tipo  text;
  v_reuniao_retomar_em   date;
  v_contato_id           uuid;
  v_faltando             text[] := '{}';
  v_saldo                numeric;
  v_quitou               boolean;
  v_prometeu             boolean;
  v_nao_prometeu         boolean;
  v_sinalizou_a          boolean;
  v_sinalizou_b          boolean;
  v_data_minima          date := current_date - 7;
begin
  -- Card do produto pedido — desempate por produto + criado_em asc + limit 1:
  -- quem tem card no HM e no AURUM avaliaria a trava contra o card errado.
  select ch.id, ch.reuniao_resultado, ch.intencao_pagamento, ch.pagamento_previsto_em,
         ch.pagamento_meio, ch.intencao_pagamento_obs,
         ch.reuniao_motivo_tipo, ch.reuniao_retomar_em
    into v_contato_id, v_reuniao_resultado, v_intencao, v_pagamento_previsto,
         v_pagamento_meio, v_intencao_obs,
         v_reuniao_motivo_tipo, v_reuniao_retomar_em
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador_id
     and coalesce(ch.produto, 'HM') = coalesce(p_produto, 'HM')
   order by ch.criado_em asc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'faltando', to_jsonb(array['ficha nao encontrada']::text[]));
  end if;

  if v_reuniao_resultado is null or btrim(v_reuniao_resultado) = '' then
    v_faltando := array_append(v_faltando, 'resultado da reunião');
  end if;

  -- 0309: o escape é QUITAR, não "ter pagamento". Fonte = saldo monetário de
  -- cs.vw_fin_contas_receber (metade dos buffers da vw_hm_financeiro aqui, e
  -- os SubPlans de fn_hm_prorata saem como `never executed` quando se filtra
  -- por contato_hm_id). NÃO usar status_financeiro/quitado: 18 cards estão
  -- marcados quitado com saldo > 0 (R$ 231.637) — fato monetário vence rótulo.
  -- Folga de R$ 1: absorve os 8 cards com resíduo de centavos.
  select greatest(coalesce(f.saldo_a_pagar, 0), 0) into v_saldo
    from cs.vw_fin_contas_receber f where f.contato_hm_id = v_contato_id limit 1;
  v_quitou := coalesce(v_saldo <= 1, false);

  -- ESCAPE: quitou, não há promessa a fazer. ⚠️ NÃO é return incondicional —
  -- devolve ok = (v_faltando vazio), preservando a exigência (a) de
  -- reuniao_resultado que vem da 0284. Ver a nota da 0308 sobre isto.
  if v_quitou then
    return jsonb_build_object('ok', array_length(v_faltando, 1) is null, 'faltando', to_jsonb(v_faltando));
  end if;

  -- Trilha [A] PROMETEU: vai_pagar + prazo + meio + observação.
  v_prometeu := coalesce(v_intencao = 'vai_pagar', false)
    and coalesce(v_pagamento_previsto is not null and v_pagamento_previsto >= v_data_minima, false)
    and coalesce(v_pagamento_meio is not null and btrim(v_pagamento_meio) <> '', false)
    and coalesce(v_intencao_obs is not null and btrim(v_intencao_obs) <> '', false);

  -- Trilha [B] NÃO PROMETEU: motivo categorizado + data de retomar + obs.
  v_nao_prometeu := coalesce(v_reuniao_motivo_tipo is not null and btrim(v_reuniao_motivo_tipo) <> '', false)
    and coalesce(v_reuniao_retomar_em is not null and v_reuniao_retomar_em >= v_data_minima, false)
    and coalesce(v_intencao_obs is not null and btrim(v_intencao_obs) <> '', false);

  if not (coalesce(v_prometeu, false) or coalesce(v_nao_prometeu, false)) then
    -- Qual trilha o operador SINALIZOU decide o que reportar: sem isto, quem
    -- marca "vai pagar" e não completa recebe a mensagem da trilha ERRADA.
    v_sinalizou_a := coalesce(v_intencao = 'vai_pagar', false)
      or coalesce(v_pagamento_previsto is not null, false)
      or coalesce(v_pagamento_meio is not null and btrim(v_pagamento_meio) <> '', false);
    v_sinalizou_b := coalesce(v_reuniao_motivo_tipo is not null and btrim(v_reuniao_motivo_tipo) <> '', false)
      or coalesce(v_reuniao_retomar_em is not null, false);

    if coalesce(v_sinalizou_a, false) and not coalesce(v_sinalizou_b, false) then
      if v_pagamento_previsto is null or v_pagamento_previsto < v_data_minima then
        v_faltando := array_append(v_faltando, 'a data em que ele prometeu pagar');
      end if;
      if v_pagamento_meio is null or btrim(v_pagamento_meio) = '' then
        v_faltando := array_append(v_faltando, 'a forma de pagamento');
      end if;
      if v_intencao_obs is null or btrim(v_intencao_obs) = '' then
        v_faltando := array_append(v_faltando, 'a observação do que foi combinado');
      end if;
    elsif coalesce(v_sinalizou_b, false) and not coalesce(v_sinalizou_a, false) then
      if v_reuniao_motivo_tipo is null or btrim(v_reuniao_motivo_tipo) = '' then
        v_faltando := array_append(v_faltando, 'o motivo de não ter prometido');
      end if;
      if v_reuniao_retomar_em is null or v_reuniao_retomar_em < v_data_minima then
        v_faltando := array_append(v_faltando, 'a data de retomar o contato');
      end if;
      if v_intencao_obs is null or btrim(v_intencao_obs) = '' then
        v_faltando := array_append(v_faltando, 'a observação do que foi combinado');
      end if;
    else
      v_faltando := array_append(v_faltando, 'a data em que ele prometeu pagar, OU o motivo de não ter prometido e a data de retomar o contato');
    end if;
  end if;

  return jsonb_build_object('ok', array_length(v_faltando, 1) is null, 'faltando', to_jsonb(v_faltando));
end$function$;

comment on function cs.fn_hm_pode_finalizar_reuniao(uuid, text) is
  '0309: trava de ENTRADA em hm_reuniao_finalizada. Exige reuniao_resultado E uma das trilhas: [A] PROMETEU (intencao_pagamento=vai_pagar + pagamento_previsto_em + pagamento_meio + intencao_pagamento_obs) ou [B] NAO PROMETEU (reuniao_motivo_tipo + reuniao_retomar_em + intencao_pagamento_obs). ESCAPE = QUITOU (saldo <= 1 em cs.vw_fin_contas_receber) — mudou na 0309: era "tem qualquer pagamento" (0284/0308), o que liberava 299 de 305 cards porque fn_hm_pagamento_do_produto nao filtra categoria e 293 das 433 linhas de hm_pagamentos sao SINAL. Quem pagou so o sinal ainda deve, e e de quem o financeiro cobra. Efeito: 161->53 liberadas. NAO usa status_financeiro/quitado como fonte: 18 cards estao marcados quitado com saldo > 0 (R$ 231.637, bug do CASE da view). O ramo `acordo` texto livre da 0284 segue REMOVIDO (0308). Datas aceitas ate 7 dias no passado. coalesce(...) em TODO predicado: a 0281 caiu por NULL tri-valorado em not(a or b or c) (PR #36). So de entrada — card ja na etapa segue livre.';

grant execute on function cs.fn_hm_pode_finalizar_reuniao(uuid, text) to disparos_app;
