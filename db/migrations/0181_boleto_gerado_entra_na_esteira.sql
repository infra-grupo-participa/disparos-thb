-- 0181 — compra gerada e NÃO paga (boleto/PIX pendente) entra na esteira.
--
-- ⚠️ APLICADA EM PRODUÇÃO em 11/08/2026
-- (supabase_migrations: 0181_boleto_gerado_entra_na_esteira).
-- O corpo da função abaixo foi extraído de produção com pg_get_functiondef —
-- é o código REAL em execução, não uma transcrição.
--
-- ── O BURACO ─────────────────────────────────────────────────────────────────────
-- O webhook só entendia PURCHASE_APPROVED. Boleto emitido dispara
-- PURCHASE_BILLET_PRINTED, que morria no guard de evento: não ia para public.compras,
-- não ia para cs.hotmart_eventos (o log só rodava DEPOIS dos guards) e o webhook
-- respondia 200 — a Hotmart considerava entregue e nunca retentava.
-- Caso: Francisco, HP4238924170, oferta rlgjsrul (R$ 697), 10/08/2026 21:18. Zero rastro.
--
-- Evidência: public.compras tinha 6 BILLET_PRINTED e 54 EXPIRED, todas de carga
-- histórica — a mais recente de 15/05/2026. Nenhuma entrou pelo webhook.
--
-- ── O QUE JÁ EXISTIA E NUNCA FOI USADO ───────────────────────────────────────────
--   · cs.contatos_hm_kanban.hotmart_status já lia compra de QUALQUER status
--   · hm-financeiro-xlsx.ts já tinha rótulo p/ PRINTED_BILLET / WAITING_PAYMENT
--   · cs.hm_alertas tem 'boleto_preso' (>10d sem aprovar) — nunca disparou, porque
--     nenhum boleto chegava
--
-- ── DECISÃO DO MARCIO (11/08/2026) ───────────────────────────────────────────────
-- Boleto gerado VIRA CARD, em coluna própria "Aguardando Pagamento" (ordem 5, antes
-- do Contato Inicial). O comercial vê e cobra antes de compensar.
--
-- ⚠️ INVARIANTE: boleto não pago gera ZERO linhas em cs.hm_pagamentos.
-- cs.fn_hm_lancar_compra continua exigindo status aprovado, e a 0183 põe uma trava
-- de banco redundante. O ramo de espera NÃO grava plano/categoria_entrada/entrada_em
-- — se gravasse, uma compra nunca paga venceria a entrada real de quem pagou,
-- quebrando a regra da 0179/0180.
--
-- ⚠️ cs.estagios NÃO tem unique em (evento, chave) → insert condicional por
-- `where not exists`, nunca `on conflict`.

begin;

-- 1) A coluna nova, antes do Contato Inicial (ordem 10).
insert into cs.estagios (evento, chave, nome, aba, ordem)
select 'HM', 'hm_aguardando_pagamento', 'Aguardando Pagamento', 'comercial', 5
where not exists (
  select 1 from cs.estagios where evento = 'HM' and chave = 'hm_aguardando_pagamento'
);

-- 2) Marcador no card: "boleto gerado, ainda não pagou".
alter table cs.contatos_hm
  add column if not exists aguardando_pagamento_em timestamptz;

comment on column cs.contatos_hm.aguardando_pagamento_em is
  '0181: quando a compra foi GERADA sem estar paga (boleto emitido / PIX pendente). Preenchido enquanto o pagamento não compensa; zerado quando a compra é aprovada. Não-nulo = o dinheiro AINDA NÃO ENTROU.';

-- 3) O seed passa a aceitar compra não paga (DDL real de produção).
CREATE OR REPLACE FUNCTION cs.fn_seed_contato_hm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cs', 'public'
AS $function$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_pend  smallint;
  v_esper smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
  v_val   record;
  v_aluno uuid;
  v_quando timestamptz;
  v_comprador uuid;
  v_turma text;
  v_aguardando boolean;
begin
  -- 0181: status de espera é aceito, por um caminho separado. Qualquer outro status
  -- não-aprovado (EXPIRED, REFUNDED, CANCELED...) segue ignorado aqui — quem trata
  -- cancelamento é o fluxo de cancelamento.
  v_aguardando := new.status in ('BILLET_PRINTED','PRINTED_BILLET','WAITING_PAYMENT');

  if new.status not in ('APPROVED','COMPLETE','COMPLETED') and not v_aguardando then
    return new;
  end if;

  v_comprador := coalesce(
    (select canonico_id from cs.hm_comprador_alias where comprador_id = new.comprador_id),
    new.comprador_id);

  if new.metodo_pagamento = 'HOTMART_INSTALLMENTS' and exists (
    select 1 from public.compras c2
     where c2.comprador_id = new.comprador_id
       and c2.oferta_codigo = new.oferta_codigo
       and c2.status in ('APPROVED','COMPLETE','COMPLETED')
       and c2.id <> new.id
       and coalesce(c2.data_aprovacao, c2.data_compra) < coalesce(new.data_aprovacao, new.data_compra)
  ) then
    return new;
  end if;

  select cat.categoria, cat.notes into v_cat, v_notes
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if v_cat is null then
    return new;
  end if;

  v_quando := coalesce(new.data_aprovacao, new.data_compra, now());
  v_turma  := cs.fn_hm_turma_por_data(coalesce(new.data_compra, new.data_aprovacao, now()));
  select id into v_ini   from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pend  from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;
  select id into v_esper from cs.estagios where evento='HM' and chave='hm_aguardando_pagamento' limit 1;

  -- ---------------------------------------------------------------------------
  -- 0181: COMPRA GERADA, AINDA NÃO PAGA.
  -- Cria o card na coluna de espera e marca aguardando_pagamento_em. NÃO grava
  -- plano/categoria_entrada nem entrada_em — não há entrada paga, e deixar o boleto
  -- escrever ali faria uma compra nunca paga vencer a entrada real de quem pagou,
  -- quebrando a regra da 0179/0180.
  -- ---------------------------------------------------------------------------
  if v_aguardando then
    if v_cat not in ('sinal','compra_cheia') or v_quando < v_cutoff then
      return new;
    end if;

    insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, aguardando_pagamento_em)
    values (v_comprador, 'HM', v_esper, v_turma, v_quando)
    on conflict (comprador_id, produto) do update
      -- Só marca quem ainda não pagou nada. Se o card já tem entrada paga, um boleto
      -- novo não pode empurrá-lo de volta para a fila — a pessoa já é cliente.
      set aguardando_pagamento_em = case
            when cs.contatos_hm.entrada_em is null
            then coalesce(cs.contatos_hm.aguardando_pagamento_em, excluded.aguardando_pagamento_em)
            else cs.contatos_hm.aguardando_pagamento_em
          end,
          atualizado_em = now();

    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Boleto gerado%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema',
              'Boleto gerado (ainda NÃO pago) — '||coalesce(v_notes,'oferta')||
              ' · transação '||coalesce(new.hotmart_transaction,'?'), 'sistema');
    end if;

    begin
      perform cs.fn_tag_hm_origem(v_comprador);
    exception when others then
      null;
    end;
    return new;
  end if;

  if new.oferta_codigo = '6qxsk9kq' and v_quando >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, apto_ativacao)
    values (v_comprador, 'HM', v_pend, v_turma, coalesce(v_notes,'Acesso ETHB'), v_cat, true)
    on conflict (comprador_id, produto) do update
      set apto_ativacao = true, atualizado_em = now();

    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema',
              'Entrou na esteira HM (renovação de acesso ETHB — 6qxsk9kq — direto para Pendente de Liberação)', 'sistema');
    end if;

    begin
      perform cs.fn_tag_hm_origem(v_comprador);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;
    return new;
  end if;

  if v_cat in ('sinal','compra_cheia') and v_quando >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, entrada_em)
    values (v_comprador, 'HM', v_ini, v_turma, v_notes, v_cat, v_quando)
    on conflict (comprador_id, produto) do update
      -- 0180: a entrada MAIS RECENTE manda (guarda contra webhook fora de ordem).
      set plano = case
                    when cs.contatos_hm.entrada_em is null
                      or excluded.entrada_em >= cs.contatos_hm.entrada_em
                    then coalesce(excluded.plano, cs.contatos_hm.plano)
                    else cs.contatos_hm.plano
                  end,
          categoria_entrada = case
                    when cs.contatos_hm.entrada_em is null
                      or excluded.entrada_em >= cs.contatos_hm.entrada_em
                    then coalesce(excluded.categoria_entrada, cs.contatos_hm.categoria_entrada)
                    else cs.contatos_hm.categoria_entrada
                  end,
          entrada_em = greatest(cs.contatos_hm.entrada_em, excluded.entrada_em),
          -- 0181: pagou — sai da fila de espera. Se o card estava esperando boleto,
          -- ele anda para o Contato Inicial; se já estava adiante, não regride.
          aguardando_pagamento_em = null,
          estagio_id = case
                         when cs.contatos_hm.aguardando_pagamento_em is not null then excluded.estagio_id
                         else cs.contatos_hm.estagio_id
                       end,
          atualizado_em = now();

    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema', 'Entrou na esteira HM ('||v_cat||' — '||coalesce(v_notes,'oferta')||')', 'sistema');
    end if;

    begin
      perform cs.fn_tag_hm_origem(v_comprador);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;

    if v_cat = 'compra_cheia' then
      update cs.contatos_hm
         set estagio_id = v_pend,
             apto_ativacao = true,
             pagamento_em = coalesce(pagamento_em, v_quando),
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_pend;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
        values (v_id, 'mudanca_estagio',
                'Compra cheia aprovada (Hotmart) — direto para "Pendente de Liberação"',
                'sistema', v_ini, v_pend);
      end if;

      begin
        select * into v_val from cs.fn_hm_valores_derivados(v_comprador);
        v_aluno := cs.fn_hm_provisionar_aluno(v_comprador, v_val.valor_total, v_val.valor_pago);
        if v_aluno is not null then
          if v_val.ambiguo then
            update public.thb_alunos
               set tratamento_manual = coalesce(tratamento_manual,
                     'Financeiro a conferir — criado pelo webhook em '||to_char(now(),'DD/MM/YYYY')||': a Hotmart pode ter gravado valor de parcela')
             where id = v_aluno;
          end if;
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Aluno criado/atualizado na base THB (compra cheia)', 'sistema');
        end if;
      exception when others then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao criar o aluno na base THB ('||sqlerrm||')', 'sistema');
      end;
    end if;
    return new;
  end if;

  if v_cat = 'diferenca' then
    v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);

    if v_id is null and v_quando >= v_cutoff then
      insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, apto_ativacao, pagamento_em)
      values (v_comprador, 'HM', v_pend, v_turma, coalesce(v_notes, 'saldo'), 'diferenca', true, v_quando)
      on conflict (comprador_id, produto) do nothing;

      v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);

      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema',
                'Entrou direto pela oferta de saldo (sem sinal) — card criado pelo pagamento do saldo', 'sistema');
        begin
          perform cs.fn_tag_hm_origem(v_comprador);
        exception when others then
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
        end;
      end if;
    end if;

    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, v_quando),
             estagio_id = v_pend,
             apto_ativacao = true,
             aguardando_pagamento_em = null,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_pend;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — pendente de liberação', 'sistema');
      end if;

      begin
        select * into v_val from cs.fn_hm_valores_derivados(v_comprador);
        v_aluno := cs.fn_hm_provisionar_aluno(v_comprador, v_val.valor_total, v_val.valor_pago);
        if v_aluno is not null then
          if v_val.ambiguo then
            update public.thb_alunos
               set tratamento_manual = coalesce(tratamento_manual,
                     'Financeiro a conferir — criado pelo webhook em '||to_char(now(),'DD/MM/YYYY')||': a Hotmart pode ter gravado valor de parcela')
             where id = v_aluno;
          end if;
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (v_id, 'sistema', 'Aluno criado na base THB (saldo quitado)', 'sistema');
        end if;
      exception when others then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao criar o aluno na base THB ('||sqlerrm||')', 'sistema');
      end;
    end if;
    return new;
  end if;

  return new;
end$function$;

commit;

-- ── TESTE EXECUTADO EM PRODUÇÃO (comprador sintético, removido depois) ───────────
--   1. boleto gerado ..... coluna "Aguardando Pagamento" · aguardando=SIM ·
--                          entrada=NÃO · pagamentos=0 · saldo 15.000
--   2. boleto compensou .. coluna "Contato Inicial" · aguardando=limpo ·
--                          entrada=SIM · pagamentos=1 · saldo 14.303,00
--   Auditoria adversarial (9/9): BILLET_PRINTED, PRINTED_BILLET, WAITING_PAYMENT e
--   EXPIRED não geram pagamento; saldo ignora boleto; ao compensar tudo casa.
--   ⚠️ ao limpar teste, apagar public.thb_alunos ANTES de public.compradores
--   (FK fk_thb_alunos_comprador): a compra aprovada provisiona aluno.
