-- =====================================================================
-- 0293_o_card_preso_no_boleto_sai_pelo_fato
--
-- D4 (decisão do Marcio): a limpeza das fichas erradas sobe JUNTO com D1/D2,
-- não depois. Esta migration cria `cs.fn_hm_reconciliar_estagio_hotmart` —
-- reposiciona o card pelo FATO (compras em public.compras + razão em
-- cs.hm_pagamentos), nunca por suposição — e roda uma vez para os casos
-- concretos encontrados na auditoria.
--
-- TRÊS REGRAS, TODAS CONSERVADORAS DE PROPÓSITO (documentado por quê):
--
--   (1) CARD PRESO NA FILA DE ESPERA (hm_boleto_gerado / hm_aguardando_pagamento,
--       aguardando_pagamento_em not null) MAS JÁ HÁ PAGAMENTO NO RAZÃO
--       (cs.hm_pagamentos) — o dinheiro já foi reconhecido, a espera devia ter
--       acabado (mesma lógica de D2/0292: sai da fila para hm_aguardando_pagamento,
--       "Sinal Pago" — não pula direto pro Contato Inicial, que segue manual).
--       Caso motivador: Lidiane — 3 compras APPROVED, R$ 2.497,00 já no razão,
--       card preso em "Boleto Gerado".
--
--   (2) CARD EM "RECLAMADA" (hm_cancelamento) COM COMPRA
--       REFUNDED/CHARGEBACK/PROTESTED/CANCELED/CANCELLED evidenciada — o pedido
--       virou FATO confirmado pela Hotmart. Efetiva o cancelamento
--       (cs.fn_hm_cancelar, mesmo caminho de confirmarCancelamentoHm) e move
--       para hm_reembolsado. Caso motivador: 4 fichas apontadas na auditoria.
--
--   (3) CARD EM "REEMBOLSADO" (hm_reembolsado) SEM NENHUMA EVIDÊNCIA DE
--       REFUNDED/CHARGEBACK/PROTESTED/CANCELED/CANCELLED — a compra segue
--       aprovada, o reembolso nunca aconteceu de fato (é exatamente o alerta
--       `reembolso_sem_baixa` da 0208 — hoje 1 caso real: Ely Takeuti, R$300).
--       Desfaz o FATO (cs.fn_hm_descancelar, mesmo caminho de
--       desfazerCancelamentoHm) e devolve o card ao ÚLTIMO estágio ANTERIOR ao
--       cancelamento — lido de cs.interacoes.estagio_anterior_id (mesma fonte
--       que reverterEstagioHm usa), nunca um estágio inventado. Se não há
--       registro de mudança de estágio para reconstituir o "antes", a função
--       NÃO adivinha: desfaz o fato mas deixa o card onde está e devolve um
--       aviso — dado incompleto não pode virar posição inventada no board.
--
-- O QUE ESTA FUNÇÃO DELIBERADAMENTE NÃO FAZ — "Reclamada sem evidência":
-- as 13 fichas em "Reclamada" sem nenhuma compra REFUNDED/PROTESTED/etc. NÃO
-- são movidas. A 0208 já provou que isso é o estado ESPERADO da coluna
-- (pedido feito, reembolso ainda não voltou) — mas o Marcio pediu para
-- revisar essas 13 porque pode haver pedido feito por TELEFONE, sem rastro
-- na Hotmart, e mover por suposição seria inventar um fato. Em vez de mover,
-- gera alerta `reclamada_sem_evidencia` em cs.hm_alertas para revisão humana
-- — mesmo padrão de cs.fn_hm_health_check (0122/0208), só que específico
-- para este caso e não resolvido sozinho pelo cron diário (que já sabe que
-- "Reclamada sem baixa" é normal — 0208 tirou esse alerta do health check de
-- propósito; este é um alerta NOVO e diferente, feito para ser lido por
-- gente, não para fechar sozinho).
--
-- Caso Iara (2 compras APPROVED posteriores ao reembolso de R$300 — R$1.000
-- em 06/08 e R$59.000 em 18/08): NÃO tem regra automática dedicada. As três
-- regras acima são conservadoras o bastante para não tocá-la por engano —
-- ela não bate na regra (1) porque não está numa coluna de espera, não bate
-- na (3) porque IARA JÁ TEM evidência de REFUNDED (é o motivo de estar em
-- "Reembolsado"), e não bate na (2) porque não está em "Reclamada". Ainda
-- assim, ela é um caso ativo e ambíguo — a rodada de execução no fim desta
-- migration confere explicitamente e grava um alerta de ATENÇÃO nominal em
-- vez de deixá-la silenciosa: comprou de novo depois do reembolso, e ninguém
-- pode tratá-la como perdida sem olhar o caso.
--
-- SECURITY DEFINER — grava mudanca_estagio com autor 'sistema' (D4/B5 pede
-- explicitamente esse autor, distinto de 'hotmart' que a 0292 usa para o
-- movimento automático do webhook — esta função roda por chamada explícita,
-- seja da migration, seja do master pela ficha).
--
-- Aditiva e idempotente: reconciliação por comprador é `select` + `update`
-- condicional (idempotente por natureza — rodar duas vezes não move quem já
-- foi reposicionado), alertas por `on conflict do nothing` (índice parcial
-- já existente, 0122).
-- =====================================================================

begin;

create or replace function cs.fn_hm_reconciliar_estagio_hotmart(p_comprador_id uuid, p_produto text default 'HM')
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_card            record;
  v_tem_pagamento   boolean;
  v_tem_evidencia_cancel boolean;
  v_esper_id        smallint;
  v_anterior_id     smallint;
  v_resultado       text;
  -- 0293/regra (4): estado financeiro e destino da porta de pagamento.
  v_situacao        text;
  v_saldo           numeric;
  v_destino_id      smallint;
begin
  select ch.id, ch.estagio_id, e.chave as estagio_chave, ch.aguardando_pagamento_em, ch.produto,
         e.aba, e.ordem
    into v_card
    from cs.contatos_hm ch
    left join cs.estagios e on e.id = ch.estagio_id
   where ch.comprador_id = p_comprador_id
     and coalesce(ch.produto, 'HM') = coalesce(p_produto, 'HM')
   order by ch.criado_em asc
   limit 1;

  if v_card.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'ficha nao encontrada');
  end if;

  -- ── REGRA (1) — preso na fila de espera, mas o razão já reconheceu o pagamento ──
  if v_card.estagio_chave in ('hm_boleto_gerado', 'hm_aguardando_pagamento')
     and v_card.aguardando_pagamento_em is not null
  then
    select exists (
      select 1 from cs.hm_pagamentos p
       where p.comprador_id = p_comprador_id
         and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, coalesce(v_card.produto, 'HM'))
    ) into v_tem_pagamento;

    if v_tem_pagamento then
      select id into v_esper_id from cs.estagios where evento = 'HM' and chave = 'hm_aguardando_pagamento' limit 1;
      update cs.contatos_hm
         set aguardando_pagamento_em = null, atualizado_em = now()
       where id = v_card.id;
      if v_esper_id is not null and v_card.estagio_id is distinct from v_esper_id then
        update cs.contatos_hm set estagio_id = v_esper_id, atualizado_em = now() where id = v_card.id;
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
        values (v_card.id, 'mudanca_estagio',
                '0293: card estava preso na fila de espera mas o razao ja tinha pagamento lancado — reconciliado pelo fato para "Sinal Pago"',
                'sistema', v_card.estagio_id, v_esper_id);
      end if;
      return jsonb_build_object('ok', true, 'acao', 'saiu_da_espera');
    end if;
  end if;

  -- ── REGRA (2) — "Reclamada" com evidência de reembolso/chargeback/protesto ──
  if v_card.estagio_chave = 'hm_cancelamento' then
    select exists (
      select 1 from public.compras c
       where c.comprador_id = p_comprador_id
         and c.status in ('REFUNDED', 'CHARGEBACK', 'PROTESTED', 'CANCELED', 'CANCELLED')
    ) into v_tem_evidencia_cancel;

    if v_tem_evidencia_cancel then
      select cs.fn_hm_cancelar(p_comprador_id, '0293: reembolso confirmado pela Hotmart (reconciliacao)', 'hotmart', coalesce(p_produto, 'HM'))
        into v_resultado;

      select id into v_esper_id from cs.estagios where evento = 'HM' and chave = 'hm_reembolsado' limit 1;
      if v_esper_id is not null and v_card.estagio_id is distinct from v_esper_id then
        update cs.contatos_hm set estagio_id = v_esper_id, atualizado_em = now() where id = v_card.id;
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
        values (v_card.id, 'mudanca_estagio',
                '0293: reembolso/chargeback/protesto confirmado na Hotmart — reconciliado de "Reclamada" para "Reembolsado"',
                'sistema', v_card.estagio_id, v_esper_id);
      end if;
      return jsonb_build_object('ok', true, 'acao', 'reclamada_para_reembolsado', 'cancelar_resultado', v_resultado);
    end if;

    -- Sem evidência: NÃO move (pode ser pedido feito por telefone, sem rastro
    -- na Hotmart) — alerta para revisão humana em vez de suposição.
    insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
    values ('reclamada_sem_evidencia', p_comprador_id::text, 'aviso',
            '0293: card em "Reclamada" sem nenhuma compra REFUNDED/CHARGEBACK/PROTESTED/CANCELED na Hotmart. '
            'Pode ser um pedido feito por telefone (sem rastro no sistema) — NAO movido automaticamente. Confirmar manualmente na ficha.')
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'acao', 'alerta_reclamada_sem_evidencia');
  end if;

  -- ── REGRA (3) — "Reembolsado" sem nenhuma evidência de reembolso/cancelamento ──
  if v_card.estagio_chave = 'hm_reembolsado' then
    select exists (
      select 1 from public.compras c
       where c.comprador_id = p_comprador_id
         and c.status in ('REFUNDED', 'CHARGEBACK', 'PROTESTED', 'CANCELED', 'CANCELLED')
    ) into v_tem_evidencia_cancel;

    if not v_tem_evidencia_cancel then
      -- Desfaz o FATO (mesmo caminho de desfazerCancelamentoHm) — a base THB
      -- volta a considerar o aluno ativo.
      perform cs.fn_hm_descancelar(p_comprador_id, coalesce(p_produto, 'HM'));

      -- Devolve o card ao ÚLTIMO estágio anterior ao cancelamento, lido do
      -- HISTÓRICO real (mesma fonte de reverterEstagioHm) — nunca um estágio
      -- inventado. Sem registro para reconstituir, não adivinha: fica onde
      -- está e devolve o aviso.
      select estagio_anterior_id into v_anterior_id
        from cs.interacoes
       where contato_hm_id = v_card.id and tipo = 'mudanca_estagio' and estagio_novo_id = v_card.estagio_id
       order by criado_em desc
       limit 1;

      if v_anterior_id is null then
        insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
        values ('reembolsado_sem_evidencia_sem_historico', p_comprador_id::text, 'critico',
                '0293: card em "Reembolsado" sem nenhuma compra REFUNDED/CHARGEBACK/PROTESTED/CANCELED na Hotmart — o cancelamento foi desfeito na base, '
                'mas nao ha registro de qual etapa o card ocupava ANTES do cancelamento para devolve-lo com seguranca. Mover manualmente na ficha.')
        on conflict do nothing;
        return jsonb_build_object('ok', true, 'acao', 'descancelado_sem_historico_de_estagio');
      end if;

      update cs.contatos_hm set estagio_id = v_anterior_id, atualizado_em = now() where id = v_card.id;
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
      values (v_card.id, 'mudanca_estagio',
              '0293: nenhuma evidencia de reembolso/chargeback/protesto na Hotmart — reconciliado de volta ao estagio anterior ao cancelamento',
              'sistema', v_card.estagio_id, v_anterior_id);
      return jsonb_build_object('ok', true, 'acao', 'reembolsado_revertido');
    end if;
  end if;

  -- ── REGRA (4) — quitou e o card não avançou: preso no COMERCIAL ──────────
  -- Caso Leandro Francatto (conferencia do Victor Hugo, 18/08): AURUM quitado
  -- em 16/08, R$ 46.927,32 do Saldo Aurum, saldo_a_perseguir = 0, e o card
  -- parado em "Aguardando Retorno" (ordem 15) com apto_ativacao = false.
  --
  -- "Pagamento Realizado" e porta, nao lugar (0181/hm.ts): quem quita atravessa
  -- e vai para a Ativacao. Este ramo NAO escolhe destino por conta propria —
  -- delega a cs.fn_hm_etapa_pos_pagamento(), a MESMA funcao que moverEstagioHm
  -- usa quando o operador passa pela porta, para que o fato e o gesto levem a
  -- pessoa exatamente ao mesmo lugar.
  --
  -- Guarda dupla, para nao arrastar quem ainda deve: exige situacao 'quitado'
  -- NA VIEW (que ja reconcilia mensalidade, credito e entrada) E saldo <= 0.
  -- Parcelado em curso tem situacao 'mensalidade_em_curso' e NAO entra aqui —
  -- foi exatamente a confusao que a conferencia manual cometeu ao procurar uma
  -- transacao unica de saldo em quem paga em parcelas.
  if v_card.aba = 'comercial' and coalesce(v_card.ordem, 0) < 50 then
    select f.situacao, coalesce(f.saldo_a_perseguir, 0)
      into v_situacao, v_saldo
      from cs.vw_hm_financeiro f
     where f.contato_hm_id = v_card.id;

    if v_situacao = 'quitado' and v_saldo <= 0 then
      -- fn_hm_etapa_pos_pagamento devolve a CHAVE (text) do estagio, e recebe
      -- so o comprador — conferido contra pg_get_function_arguments no banco.
      select e.id into v_destino_id
        from cs.estagios e
       where e.evento = 'HM'
         and e.chave = cs.fn_hm_etapa_pos_pagamento(p_comprador_id)
         and e.ativo
       limit 1;

      if v_destino_id is null or v_destino_id = v_card.estagio_id then
        insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
        values ('quitado_preso_no_comercial', p_comprador_id::text, 'critico',
                '0293: quitou (saldo zero) e o card continua no Comercial, mas fn_hm_etapa_pos_pagamento nao resolveu um destino. Mover manualmente na ficha.')
        on conflict do nothing;
        return jsonb_build_object('ok', true, 'acao', 'quitado_preso_sem_destino');
      end if;

      update cs.contatos_hm
         set estagio_id = v_destino_id,
             apto_ativacao = true,
             pagamento_em = coalesce(pagamento_em, quitado_em, now()),
             atualizado_em = now()
       where id = v_card.id;

      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
      values (v_card.id, 'mudanca_estagio',
              '0293: saldo quitado e sem nada a perseguir — reconciliado do Comercial para a Ativacao pelo fato do pagamento',
              'sistema', v_card.estagio_id, v_destino_id);

      return jsonb_build_object('ok', true, 'acao', 'quitado_seguiu_para_ativacao');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'acao', 'nada_a_fazer');
end$fn$;

comment on function cs.fn_hm_reconciliar_estagio_hotmart(uuid, text) is
  '0293 (D4): reposiciona o card pelo FATO (public.compras + cs.hm_pagamentos), nunca por suposicao. (1) preso na fila de espera com pagamento ja no razao -> sai para hm_aguardando_pagamento. (2) Reclamada com REFUNDED/CHARGEBACK/PROTESTED/CANCELED evidenciado -> efetiva cancelamento e move para hm_reembolsado. (3) Reembolsado sem nenhuma evidencia -> desfaz o fato e devolve ao estagio anterior (lido do historico real, cs.interacoes) ou alerta se nao ha historico. Reclamada SEM evidencia gera alerta reclamada_sem_evidencia para revisao humana (pode ser pedido por telefone) -- nunca move por suposicao.';

grant execute on function cs.fn_hm_reconciliar_estagio_hotmart(uuid, text) to disparos_app;

-- ── Rodada única para os casos conhecidos (D4: a limpeza sobe junto) ─────────
-- Por CRITÉRIO DE FATO (as três regras acima), não por nome/e-mail hardcoded
-- — os nomes citados na auditoria (Lidiane, os 4 de Reclamada->Reembolsado,
-- Ely Takeuti) são a EVIDÊNCIA que motivou a regra, não um filtro do código.
-- Escopo: só HM (p_produto default) e só quem hoje está numa das colunas que
-- as regras (1)/(2)/(3) tratam — não varre o board inteiro.
do $$
declare
  v_alvo record;
  v_n_espera int := 0;
  v_n_reclamada_evid int := 0;
  v_n_reclamada_sem int := 0;
  v_n_reembolsado_revertido int := 0;
  v_n_reembolsado_sem_historico int := 0;
  v_res jsonb;
begin
  for v_alvo in
    select ch.comprador_id
      from cs.contatos_hm ch
      join cs.estagios e on e.id = ch.estagio_id
     where coalesce(ch.produto, 'HM') = 'HM'
       and e.chave in ('hm_boleto_gerado', 'hm_aguardando_pagamento', 'hm_cancelamento', 'hm_reembolsado')
       and (
         (e.chave in ('hm_boleto_gerado', 'hm_aguardando_pagamento') and ch.aguardando_pagamento_em is not null)
         or e.chave in ('hm_cancelamento', 'hm_reembolsado')
       )
  loop
    v_res := cs.fn_hm_reconciliar_estagio_hotmart(v_alvo.comprador_id, 'HM');
    case v_res->>'acao'
      when 'saiu_da_espera' then v_n_espera := v_n_espera + 1;
      when 'reclamada_para_reembolsado' then v_n_reclamada_evid := v_n_reclamada_evid + 1;
      when 'alerta_reclamada_sem_evidencia' then v_n_reclamada_sem := v_n_reclamada_sem + 1;
      when 'reembolsado_revertido' then v_n_reembolsado_revertido := v_n_reembolsado_revertido + 1;
      when 'descancelado_sem_historico_de_estagio' then v_n_reembolsado_sem_historico := v_n_reembolsado_sem_historico + 1;
      else null;
    end case;
  end loop;

  raise notice '0293: % card(s) saiu da fila de espera (pagamento ja no razao); % Reclamada->Reembolsado (evidencia confirmada); % alerta(s) reclamada_sem_evidencia; % Reembolsado revertido ao estagio anterior; % Reembolsado sem historico para reverter (alerta critico gravado).',
    v_n_espera, v_n_reclamada_evid, v_n_reclamada_sem, v_n_reembolsado_revertido, v_n_reembolsado_sem_historico;
end $$;

-- Caso Iara — NÃO tratado pelas 3 regras (ver o comentário no topo). Gera um
-- alerta NOMINAL de atenção sempre que existir alguém em "Reembolsado" com
-- reembolso evidenciado E compra(s) APPROVED POSTERIORES ao reembolso — sinal
-- de que a pessoa pode ter voltado a comprar depois de ter sido reembolsada,
-- e "reembolsado" já não é o retrato certo dela. Não move nada (ambíguo por
-- natureza: pode ser recompra legítima ou dado a conferir) — só levanta a mão.
insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
select 'reembolsado_com_compra_posterior', ch.comprador_id::text, 'critico',
       '0293: card em "Reembolsado" (reembolso confirmado na Hotmart em ' || to_char(cr.data_reembolso, 'DD/MM/YYYY') ||
       ') mas ha ' || cp_post.n || ' compra(s) APPROVED POSTERIOR(ES) ao reembolso, somando R$ ' ||
       to_char(cp_post.total, 'FM999G999G990D00') || '. NAO tratar como cliente perdida sem olhar o caso — '
       'pode ter comprado de novo depois. Avaliar manualmente.'
  from cs.contatos_hm ch
  join cs.estagios e on e.id = ch.estagio_id
  join lateral (
    select max(c.data_aprovacao) as data_reembolso
      from public.compras c
     where c.comprador_id = ch.comprador_id
       and c.status in ('REFUNDED', 'CHARGEBACK', 'PROTESTED', 'CANCELED', 'CANCELLED')
  ) cr on cr.data_reembolso is not null
  join lateral (
    select count(*) as n, coalesce(sum(c2.preco), 0) as total
      from public.compras c2
     where c2.comprador_id = ch.comprador_id
       and c2.status in ('APPROVED', 'COMPLETE', 'COMPLETED')
       and coalesce(c2.data_aprovacao, c2.data_compra) > cr.data_reembolso
  ) cp_post on cp_post.n > 0
 where coalesce(ch.produto, 'HM') = 'HM'
   and e.chave = 'hm_reembolsado'
on conflict do nothing;

commit;
