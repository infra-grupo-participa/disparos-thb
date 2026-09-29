-- =====================================================================
-- 0308_o_desfecho_da_reuniao_tem_prazo
--
-- Substitui a trava de entrada em "Reunião Finalizada" (cs.fn_hm_pode_
-- finalizar_reuniao, 0284): o ramo `acordo` texto livre não-vazio SAI —
-- medido em produção, 54 cards usaram esse atalho com pagamento_previsto_em
-- NULL (R$ 625k parados em Reunião Finalizada sem data; board financeiro
-- com 147 cards sem data / R$ 3,2 mi contra 1 único com prazo futuro).
--
-- Regra nova (D2/D4, decisão do Marcio): PRAZO SEMPRE — data de pagamento
-- só quando houver promessa. Continua exigindo (a) reuniao_resultado
-- preenchido, e (b) UM dos três, sem meio-termo de texto livre:
--
--   [A] PROMETEU     — intencao_pagamento = 'vai_pagar'
--                       + pagamento_previsto_em preenchido
--                       + pagamento_meio preenchido
--                       + intencao_pagamento_obs preenchido (a observação
--                         do que foi combinado)
--   [B] NÃO PROMETEU — reuniao_motivo_tipo preenchido (lista fechada)
--                       + reuniao_retomar_em preenchido
--                       + intencao_pagamento_obs preenchido
--   ESCAPE            — já existe pagamento registrado para este card
--                        (cs.hm_pagamentos) — fato consumado, igual 0284.
--
-- `indeciso` MUDOU de trilha: na 0284/0281 ele liberava sozinho junto com
-- `vai_pagar`. Agora só `vai_pagar` é promessa — `indeciso` é um MOTIVO da
-- trilha [B] (não prometeu), porque "tá indeciso" não tem data de pagamento
-- para gravar. `nao_vai_pagar` segue sem liberar sozinho (não é um dos três
-- motivos de reuniao_motivo_tipo — vira 'outro' na prática, com a
-- observação explicando).
--
-- MESMA assinatura `(uuid, text) returns jsonb`, mesmo contrato
-- `{ok, faltando[]}`, mesma `stable security definer set search_path` —
-- create or replace na assinatura idêntica SUBSTITUI a função (trocar a
-- assinatura criaria sobrecarga em vez de substituir, e o código que chama
-- `cs.fn_hm_pode_finalizar_reuniao($1, $2)` ficaria ambíguo). O `reason`
-- devolvido pelo chamador (lib/services/hm.ts) continua 'reuniao_sem_
-- desfecho' — não mexido aqui, é código de aplicação.
--
-- `coalesce(..., false)` em TODO predicado — a 0281 caiu exatamente por NULL
-- tri-valorado em `not(a or b or c)` (PR #36): v_intencao IN (...) com valor
-- NULL devolve NULL (não false), e dentro do not(... or ...) o IF não
-- disparava — ficha SEM desfecho passava pela trava. Repetido aqui de
-- propósito, em cada predicado, não só no not() final.
--
-- Data no passado (D2): aceita reuniao_retomar_em/pagamento_previsto_em até
-- 7 dias atrás (cobre reunião de sexta lançada na segunda), recusa além
-- disso (barra nascer vencido de 30 dias). Sem trava para data FUTURA —
-- "vai pagar daqui a 60 dias" é uma promessa válida.
--
-- Sem backfill, sem trava retroativa — só entrada (moverEstagioHm), os
-- cards já na coluna hoje seguem livres, mesmo princípio da 0284/0306.
--
-- ⚠️ APLICADA EM PRODUCAO 20/08/2026 — este arquivo versiona o que JÁ RODA.
-- O corpo abaixo foi conferido contra
-- `pg_get_functiondef('cs.fn_hm_pode_finalizar_reuniao(uuid,text)')` em 21/08.
-- A 1a versao deste arquivo DIVERGIA do que foi realmente aplicado em dois
-- pontos (escape incondicional e roteamento da mensagem de faltando) —
-- reaplica-la teria REGREDIDO a trava em producao, liberando 138 fichas que
-- tem pagamento mas estao sem reuniao_resultado. Corrigido em 21/08. Antes de
-- reaplicar qualquer coisa aqui, repita a conferencia: e a mesma disciplina
-- que a 0281:81-85 e a 0307:66-75 exigem — e foi ela que fez a 0307 descobrir
-- que a 0306 esquecera 2 campos no undo.
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
  v_faltando             text[] := '{}';
  v_tem_pagamento        boolean;
  v_prometeu             boolean;
  v_nao_prometeu         boolean;
  v_sinalizou_a          boolean;
  v_sinalizou_b          boolean;
  v_data_minima          date := current_date - 7;
begin
  -- Card do produto pedido — mesmo desempate do resto do módulo (produto
  -- explícito, order by criado_em asc, limit 1): sem isso, quem tem card no
  -- HM e no AURUM avaliaria a trava contra o card errado.
  select ch.reuniao_resultado, ch.intencao_pagamento, ch.pagamento_previsto_em,
         ch.pagamento_meio, ch.intencao_pagamento_obs,
         ch.reuniao_motivo_tipo, ch.reuniao_retomar_em
    into v_reuniao_resultado, v_intencao, v_pagamento_previsto,
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

  v_tem_pagamento := coalesce(exists (
    select 1 from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, coalesce(p_produto, 'HM'))
  ), false);

  -- ESCAPE (fato consumado): já tem pagamento registrado, nenhuma trilha
  -- precisa ser avaliada. ⚠️ NÃO é um `return true` incondicional: devolve
  -- `ok = (v_faltando vazio)`, preservando a exigência (a) de reuniao_resultado
  -- que vem da 0284. Medido em 20/08: 138 fichas TÊM pagamento e estão SEM
  -- reuniao_resultado — um return incondicional aqui liberaria essas 138 sem
  -- registro nenhum da reunião, que é exatamente o buraco que esta migration
  -- veio fechar. O bug existiu na 1ª versão deste arquivo e foi corrigido na
  -- aplicação; este corpo É o que roda em produção (conferido com
  -- pg_get_functiondef em 21/08).
  if v_tem_pagamento then
    return jsonb_build_object('ok', array_length(v_faltando, 1) is null, 'faltando', to_jsonb(v_faltando));
  end if;

  -- Trilha [A] PROMETEU: vai_pagar + prazo + meio + observação. Prazo aceito
  -- até 7 dias no passado (reunião de sexta lançada na segunda).
  v_prometeu := coalesce(v_intencao = 'vai_pagar', false)
    and coalesce(v_pagamento_previsto is not null and v_pagamento_previsto >= v_data_minima, false)
    and coalesce(v_pagamento_meio is not null and btrim(v_pagamento_meio) <> '', false)
    and coalesce(v_intencao_obs is not null and btrim(v_intencao_obs) <> '', false);

  -- Trilha [B] NÃO PROMETEU: motivo categorizado + data de retomar +
  -- observação. Mesma regra de data (7 dias no passado).
  v_nao_prometeu := coalesce(v_reuniao_motivo_tipo is not null and btrim(v_reuniao_motivo_tipo) <> '', false)
    and coalesce(v_reuniao_retomar_em is not null and v_reuniao_retomar_em >= v_data_minima, false)
    and coalesce(v_intencao_obs is not null and btrim(v_intencao_obs) <> '', false);

  if not (coalesce(v_prometeu, false) or coalesce(v_nao_prometeu, false)) then
    -- Qual trilha o operador SINALIZOU (mesmo incompleta) decide o que
    -- reportar. Sem isto, quem marca "vai pagar" e não completa recebia
    -- "falta o motivo de não ter prometido" — mensagem da trilha ERRADA.
    -- Testar B antes de A (1ª versão deste arquivo) produzia exatamente isso.
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
      -- Nenhuma trilha sinalizada: não escolhe uma para detalhar — diz as DUAS
      -- saídas possíveis, senão o operador acha que só existe a trilha B.
      v_faltando := array_append(v_faltando, 'a data em que ele prometeu pagar, OU o motivo de não ter prometido e a data de retomar o contato');
    end if;
  end if;

  return jsonb_build_object('ok', array_length(v_faltando, 1) is null, 'faltando', to_jsonb(v_faltando));
end$function$;

comment on function cs.fn_hm_pode_finalizar_reuniao(uuid, text) is
  '0308: trava de ENTRADA em hm_reuniao_finalizada (D2/D4) — exige reuniao_resultado preenchido E uma das duas trilhas: [A] PROMETEU (intencao_pagamento=vai_pagar + pagamento_previsto_em + pagamento_meio + intencao_pagamento_obs) ou [B] NAO PROMETEU (reuniao_motivo_tipo + reuniao_retomar_em + intencao_pagamento_obs), OU pagamento ja registrado (escape, fato consumado). O ramo `acordo` texto livre da 0284 foi REMOVIDO: media em producao, 54 cards usaram esse atalho com pagamento_previsto_em NULL (R$ 625k parados em Reuniao Finalizada sem data, board financeiro com 147 cards sem data contra 1 unico com prazo futuro — texto livre nao e desfecho verificavel). `indeciso` deixou de liberar sozinho (0281/0284): agora e um MOTIVO da trilha [B], nao um desfecho por si. Datas aceitas ate 7 dias no passado (reuniao de sexta lancada na segunda), recusadas alem disso. Os coalesce(...) em TODO predicado nao sao decoracao: a 0281 caiu exatamente por NULL tri-valorado em not(a or b or c) (PR #36) — valor NULL em comparacao devolve NULL, nao false, e o IF nao dispara. So de entrada: card ja na etapa segue livre (D4).';

grant execute on function cs.fn_hm_pode_finalizar_reuniao(uuid, text) to disparos_app;

-- comment on column de intencao_pagamento (0281:47-48) ficou desatualizado:
-- dizia que vai_pagar/indeciso liberavam juntos. Agora só vai_pagar é
-- promessa (trilha [A]) — indeciso é um MOTIVO possível da trilha [B],
-- junto com quer_parcelar/vai_ver_contrato/sem_condicao_agora/outro
-- (reuniao_motivo_tipo, 0307).
comment on column cs.contatos_hm.intencao_pagamento is
  '0281/0308: declaracao comercial do desfecho da reuniao (vai_pagar/indeciso/nao_vai_pagar) — irma de `acordo` (0056, hoje so texto de apoio), NAO e dado de pagamento. Usada por cs.fn_hm_pode_finalizar_reuniao (0308): vai_pagar SOZINHO nao libera mais — precisa vir com pagamento_previsto_em + pagamento_meio + intencao_pagamento_obs (trilha [A], PROMETEU). indeciso NAO libera por si: e um dos motivos possiveis de reuniao_motivo_tipo (trilha [B], NAO PROMETEU, exige reuniao_retomar_em + intencao_pagamento_obs). nao_vai_pagar nunca libera sozinho. Nunca aceitar como rota lateral para transacao — essa continua restrita a pagamento_so_hotmart.';
