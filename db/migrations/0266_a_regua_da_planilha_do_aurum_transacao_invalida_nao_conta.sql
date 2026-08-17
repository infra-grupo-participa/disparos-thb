-- =====================================================================
-- 0266 — a régua da planilha do AURUM entra no banco: transação inválida
--        NÃO conta como dinheiro recebido.
--
-- ── A FONTE DE VERDADE (Marcio, 17/08/2026) ─────────────────────────────────────
-- O Marcio mandou a planilha `[ETHB_2026 - SP] VENDAS AURUM.xlsx` e as fórmulas
-- que a governam, pedindo: "Usa ela como referencia, e resolve de vez o problema
-- que estamos tendo com o aurum".
--
-- A lógica dela, traduzida:
--
--   aba "Vendas Aprovadas"      = FILTER(Transações; R="APPROVED"; Q="qm4lu7py")
--                                 → o SINAL do Aurum. 35 linhas.
--   aba "Saldo"                 = as ofertas de saldo (e288p4zk, vzehb16i). 3 linhas.
--   aba "Transações Inválidas"  = UNIQUE(FILTER(Transações;
--                                   REGEXMATCH(R; "CANCELED|REFUNDED|DISPUTE|EXPIRED")))
--                                 → o que NÃO pode contar. 10 linhas.
--
-- Q = "Código de Oferta", R = "Status da Transação", X = "ID Transação".
--
-- ⚠️ A planilha filtra o sinal por `Q="qm4lu7py"` — só a oferta do sinal. As
-- ofertas de SALDO vivem em outra aba de propósito. O banco já modela isso pela
-- `categoria` do catálogo (sinal / diferenca / compra_cheia), então a régua que
-- importa migrar é a das INVÁLIDAS: o recorte que a planilha faz e o banco NÃO
-- fazia.
--
-- ── O QUE A RECONCILIAÇÃO ACHOU (medido, 17/08) ─────────────────────────────────
-- Planilha × banco, por ID de transação:
--   35/35 vendas aprovadas .... existem em public.compras E têm pagamento ✅
--    3/3  de saldo ............ idem ✅  (inclui o Leandro, HP2057016447)
--   13    transações INVÁLIDAS . com pagamento AINDA lançado ❌ R$ 18.490,98
--
-- Dos 13: 12 estão em "Reembolsado" com `situacao='cancelado'` — o card está
-- tratado e o dinheiro fica no histórico de propósito ("o dinheiro entrou e isso
-- não se apaga"; `cancelado=true` já o tira da cobrança). Mas **1 era furo real**:
--
--   Iara Célia Batista de Castro — card AURUM/Contato Inicial, ATIVO.
--   HP3137855494 sinal AURUM R$ 1.000 APPROVED  → legítimo
--   HP3485117132 sinal HM    R$   300 REFUNDED  → seguia lançado
--   O card contava pago R$ 1.300 tendo recebido R$ 1.000.
--
-- Corrigido à mão antes desta migration com cs.fn_hm_estornar_pagamento
-- (R$ 1.300 → R$ 1.000, motivo registrado na timeline).
--
-- ── A CAUSA RAIZ ────────────────────────────────────────────────────────────────
-- `trg_hm_compra_cancelada` (fn_hm_compra_cancelada) reage ao cancelamento da
-- Hotmart movendo o CARD — mas **nenhuma trigger estorna o PAGAMENTO**. O
-- cancelamento cuidava do kanban e esquecia do razão. Enquanto o card ficava
-- cancelado (e portanto fora da cobrança) o furo era invisível; quando a compra
-- reembolsada é de OUTRO produto (o caso da Iara: sinal HM reembolsado, card
-- AURUM ativo), o dinheiro fantasma some no meio do pago de um card que ninguém
-- cancelou.
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────────
-- Estende fn_hm_compra_cancelada para, além de mover o card, ESTORNAR o
-- pagamento daquela transação — a régua da aba "Transações Inválidas", agora no
-- banco, aplicada na hora em que a Hotmart avisa.
--
-- ⚠️ NÃO mexe nos 12 casos históricos já em "Reembolsado": lá o dinheiro no
-- histórico é a decisão vigente, e reescrever passado de card cancelado não é
-- pedido de ninguém. A trava vale de agora em diante + o alerta abaixo mostra
-- qualquer resíduo.
-- =====================================================================

-- ── [1] O cancelamento passa a estornar o pagamento ──────────────────────────
create or replace function cs.fn_hm_compra_cancelada()
returns trigger
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_dono uuid; v_card_id uuid; v_produto text; v_est_ant smallint;
  v_est_cancel smallint; v_motivo text;
  v_pag record;
begin
  begin
    v_dono := cs.fn_hm_dono_do_pagamento(new.comprador_id);

    select ch.id, ch.estagio_id, ch.produto
      into v_card_id, v_est_ant, v_produto
      from cs.contatos_hm ch
     where ch.comprador_id = v_dono
       and cs.fn_hm_pagamento_do_produto(new.oferta_codigo, ch.produto)
     order by (ch.produto = 'HM') desc, ch.criado_em asc
     limit 1;

    v_motivo := 'Cancelado na Hotmart (' || coalesce(new.hotmart_event, new.status) || ')';

    -- ── 0266: ESTORNO DO PAGAMENTO ──────────────────────────────────────────
    -- A régua da aba "Transações Inválidas" da planilha VENDAS AURUM: transação
    -- CANCELED/REFUNDED/DISPUTE/EXPIRED não conta como dinheiro recebido. Roda
    -- ANTES da parte do card, e independe de haver card do produto da compra —
    -- era exatamente esse o furo da Iara Célia (sinal HM reembolsado, card AURUM
    -- ativo: o card não casava a oferta, a função saía no `if v_card_id is null`
    -- e o pagamento reembolsado seguia lançado, inflando o pago do AURUM).
    for v_pag in
      select p.id from cs.hm_pagamentos p
       where p.transacao = new.hotmart_transaction
         and new.hotmart_transaction is not null
    loop
      perform cs.fn_hm_estornar_pagamento(
        v_pag.id,
        v_motivo || ' — transacao invalida nao conta como recebido (regua da planilha VENDAS AURUM, 0266)',
        'hotmart');
    end loop;

    if v_card_id is null then return new; end if;

    -- 0199: só o board da compra cancelada.
    perform cs.fn_hm_cancelar(v_dono, v_motivo, 'hotmart', coalesce(v_produto,'HM'));

    update cs.contatos_hm
       set hotmart_cancelado_em           = coalesce(hotmart_cancelado_em, now()),
           hotmart_cancelamento_evento    = coalesce(new.hotmart_event, new.status),
           hotmart_cancelamento_transacao = new.hotmart_transaction,
           atualizado_em                  = now()
     where id = v_card_id;

    select id into v_est_cancel from cs.estagios where chave='hm_cancelamento' and evento='HM';
    if v_est_cancel is not null and v_est_ant is distinct from v_est_cancel then
      update cs.contatos_hm set estagio_id = v_est_cancel, atualizado_em = now() where id = v_card_id;
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
      values (v_card_id, 'mudanca_estagio',
              'Movido para "Solicitou Cancelamento" pelo cancelamento na Hotmart ('||coalesce(v_produto,'?')||')',
              'hotmart', v_est_ant, v_est_cancel);
    end if;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card_id, 'sistema', v_motivo || ' — board '||coalesce(v_produto,'?')||'. Remover os acessos desse produto.', 'hotmart');
  exception when others then
    -- ⚠️ 0266: o `null` aqui é HERDADO (0193) e mantido de propósito — derrubar a
    -- gravação da compra por causa de um efeito colateral seria pior. MAS ele
    -- engolia o erro em silêncio (a armadilha da 0118). Agora deixa rastro:
    -- o alerta `pagamento_de_transacao_invalida` (bloco [2]) pega qualquer
    -- estorno que não aconteceu, venha de exceção aqui ou de qualquer outro
    -- caminho.
    null;
  end;
  return new;
end$function$;

comment on function cs.fn_hm_compra_cancelada() is
  '0193/0266: propaga o cancelamento da Hotmart para o card DO PRODUTO da compra cancelada E estorna o pagamento daquela transacao (0266 — regua da aba "Transacoes Invalidas" da planilha VENDAS AURUM: CANCELED/REFUNDED/DISPUTE/EXPIRED nao conta como recebido). O estorno roda ANTES da parte do card e INDEPENDE de existir card do produto da compra — era esse o furo do caso Iara Celia (sinal HM reembolsado, card AURUM ativo: a funcao saia no if v_card_id is null e o pagamento reembolsado seguia lancado).';

-- ── [2] Alerta: pagamento de transação inválida ainda lançado ────────────────
-- Rede de segurança para o que o `exception when others then null` engolir, e
-- para resíduo histórico que apareça depois. Só card ATIVO: nos cancelados o
-- dinheiro no histórico é a decisão vigente (ver cabeçalho).
create or replace function cs.fn_hm_alerta_pagamento_invalido()
returns integer
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_n integer := 0;
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'pagamento_de_transacao_invalida', p.id::text, 'critico',
         format('%s teve a compra %s marcada como %s na Hotmart, mas o pagamento de R$ %s (%s) segue contando como recebido — o valor pago dessa pessoa está maior do que o que entrou de verdade.',
                coalesce(cmp.nome, '(sem nome)'),
                coalesce(c.hotmart_transaction, '(sem transacao)'),
                c.status,
                translate(to_char(p.valor, 'FM999G999G999D00'), ',.', '.,'),
                p.categoria)
    from cs.hm_pagamentos p
    join public.compras c on c.hotmart_transaction = p.transacao
    join compradores cmp on cmp.id = p.comprador_id
   where c.status in ('CANCELED','REFUNDED','DISPUTE','CHARGEBACK','PROTESTED','EXPIRED')
     -- só onde o dinheiro fantasma ainda pesa: card ativo do produto da oferta
     and exists (
       select 1 from cs.contatos_hm ch
        where ch.comprador_id = p.comprador_id
          and ch.cancelamento_em is null
          and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto))
     and not exists (
       select 1 from cs.hm_alertas a
        where a.tipo = 'pagamento_de_transacao_invalida'
          and a.chave = p.id::text and a.resolvido_em is null)
   on conflict do nothing;
  get diagnostics v_n = row_count;

  -- Auto-resolução: o pagamento foi estornado (a linha deixou de existir) ou o
  -- card foi cancelado — o alerta fecha sozinho.
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null
     and a.tipo = 'pagamento_de_transacao_invalida'
     and not exists (select 1 from cs.hm_pagamentos p where p.id::text = a.chave);

  return v_n;
end$function$;

comment on function cs.fn_hm_alerta_pagamento_invalido() is
  '0266: alerta critico quando um pagamento de transacao CANCELED/REFUNDED/DISPUTE/EXPIRED segue lancado em card ATIVO — o pago da pessoa fica maior que o recebido de verdade. Rede de seguranca para o que o exception-null de fn_hm_compra_cancelada engolir. Nao alerta em card cancelado: la o dinheiro no historico e a decisao vigente. Auto-resolve quando o pagamento e estornado.';

grant execute on function cs.fn_hm_alerta_pagamento_invalido() to disparos_app;

-- Injeta no health check diário por replace mecânico (padrão 0216/0233/0263/0265).
do $$
declare v_def text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  if v_def is null then
    raise exception '0266: cs.fn_hm_health_check nao encontrada — abortado antes de mexer em nada';
  end if;

  if v_def like '%fn_hm_alerta_pagamento_invalido%' then
    raise exception '0266: cs.fn_hm_health_check ja chama fn_hm_alerta_pagamento_invalido() — migration ja aplicada, abortado para nao duplicar';
  end if;

  v_novo := replace(v_def,
    E'\n  return query',
    E'\n  perform cs.fn_hm_alerta_pagamento_invalido();\n\n  return query');

  if v_novo = v_def then
    raise exception '0266: a ancora "return query" nao casou no fonte de cs.fn_hm_health_check — abortado antes de gravar funcao incompleta';
  end if;

  execute v_novo;
end $$;

-- ── TRAVAS FINAIS (padrão 0263/0264/0265) ────────────────────────────────────
do $$
declare v_def text; v_chamadas int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_compra_cancelada';

  if v_def not ilike '%fn_hm_estornar_pagamento%' then
    raise exception '0266: cs.fn_hm_compra_cancelada() nao chama fn_hm_estornar_pagamento — o estorno nao entrou. Abortado.';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  v_chamadas := (length(v_def) - length(replace(v_def, 'fn_hm_alerta_pagamento_invalido', '')))
                 / length('fn_hm_alerta_pagamento_invalido');
  if v_chamadas <> 1 then
    raise exception '0266: fn_hm_health_check deveria chamar fn_hm_alerta_pagamento_invalido() exatamente 1 vez, achei %.', v_chamadas;
  end if;
end $$;
