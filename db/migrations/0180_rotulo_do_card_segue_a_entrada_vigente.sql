-- 0180 — o rotulo do card (plano / categoria_entrada) para de congelar na 1a compra.
--
-- ⚠️ REGISTRO DO QUE JA FOI APLICADO EM PRODUCAO em 11/08/2026 com este mesmo nome
-- (supabase_migrations.schema_migrations: 0180_rotulo_do_card_segue_a_entrada_vigente).
-- Continuacao direta da 0179 (entrada vigente = a ULTIMA compra).
--
-- ── O QUE FALTAVA ────────────────────────────────────────────────────────────────
-- A 0179 corrigiu o CALCULO (cs.vw_hm_financeiro) e a EXIBICAO (cs.contatos_hm_kanban),
-- mas o rotulo gravado em cs.contatos_hm continuava congelado, porque
-- cs.fn_seed_contato_hm fazia:
--     set plano = coalesce(cs.contatos_hm.plano, excluded.plano),
--         categoria_entrada = coalesce(cs.contatos_hm.categoria_entrada, excluded.categoria_entrada)
-- coalesce(EXISTENTE, novo) => o valor da 1a compra nunca era sobrescrito. O card da
-- Adreiza foi corrigido a mao na 0179; sem esta migration, a proxima recompra de
-- qualquer aluno congelaria o rotulo de novo.
--
-- ── POR QUE NAO E SO TROCAR PARA `excluded` ──────────────────────────────────────
-- O webhook da Hotmart reprocessa e pode entregar eventos FORA DE ORDEM (um evento
-- antigo depois de um novo). Com `excluded` puro, uma compra velha reentregue
-- sobrescreveria o rotulo da entrada vigente — trocaria um bug de congelamento por um
-- bug de regressao silenciosa, pior porque intermitente e dificil de reproduzir.
--
-- Solucao: a coluna cs.contatos_hm.entrada_em guarda QUANDO foi a entrada que produziu o
-- rotulo atual. O upsert so sobrescreve se a compra recebida for MAIS RECENTE. E a mesma
-- regra da 0179 (a ultima vence), aplicada agora tambem na ESCRITA.
--
-- `on conflict (comprador_id, produto)` ja estava correto em producao, entao o
-- isolamento HM x AURUM continua garantido: Aurum nao mexe no rotulo do card HM.
--
-- ── TESTE EXECUTADO EM PRODUCAO (com limpeza depois) ─────────────────────────────
-- Inseri 2 compras de teste no card da Adreiza e conferi o efeito no trigger:
--   1. inicial ......................... "Entrada HM R$697"  entrada_em 11/08
--   2. recompra MAIS NOVA (20/08) ...... "Sinal R$300"       entrada_em 20/08  ✅ atualizou
--   3. evento ANTIGO reprocessado ...... "Sinal R$300"       entrada_em 20/08  ✅ NAO regrediu
-- Dado de teste removido (compras + hm_pagamentos) e o card restaurado para o estado
-- real (697 / 11-08). Conferido: 0 linhas 'TESTE_ROLLBACK%' remanescentes.
--
-- ── VERIFICACAO DO BOARD ─────────────────────────────────────────────────────────
--   284 cards · Adreiza segue em 14.303,00 · cravado desrespeitado: 0
--   'incalculavel': 29 · public.vw_aluno_360: 1.812 linhas
--   230 cards receberam entrada_em no backfill
--
-- ⚠️ A SOMA DO BOARD NAO E ESTAVEL ENTRE EXECUCOES, e isso NAO e regressao:
-- 85 cards tem credito pro-rata ativo, e cs.fn_hm_prorata consome dias corridos ate
-- now(). O saldo desses cards muda sozinho com a passagem do tempo. Ao comparar
-- snapshots do board, separe `credito > 0` (variavel por tempo) de `credito is null or
-- credito = 0` (estavel) — so a parte estavel serve como teste de nao-regressao.

begin;

alter table cs.contatos_hm
  add column if not exists entrada_em timestamptz;

comment on column cs.contatos_hm.entrada_em is
  '0180: data da compra de entrada que produziu `plano`/`categoria_entrada`. Serve de guarda no upsert do cs.fn_seed_contato_hm: so uma entrada MAIS RECENTE sobrescreve o rotulo. Evita que webhook reprocessado fora de ordem regrida o card.';

-- Backfill pela entrada vigente que a 0179 ja expoe. Sem isso, card legado ficaria com
-- entrada_em NULL e a 1a compra reprocessada venceria a guarda.
update cs.contatos_hm ch
   set entrada_em = f.entrada_pago_em
  from cs.vw_hm_financeiro f
 where f.contato_hm_id = ch.id
   and f.entrada_pago_em is not null
   and ch.entrada_em is distinct from f.entrada_pago_em;

create or replace function cs.fn_seed_contato_hm()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'cs', 'public'
as $function$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_pend  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
  v_val   record;
  v_aluno uuid;
  v_quando timestamptz;
  v_comprador uuid;
  v_turma text;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
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
  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

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
      -- 0180: a entrada MAIS RECENTE manda. Antes era coalesce(EXISTENTE, novo), que
      -- congelava o rotulo na 1a compra e fazia o card da Adreiza dizer "Sinal R$300"
      -- mesmo depois da entrada de 697. A guarda por data evita que um evento antigo
      -- reprocessado pela Hotmart regrida o rotulo.
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

-- ── PENDENCIAS QUE SEGUEM ABERTAS ────────────────────────────────────────────────
-- 1. Literais 14700/15000 em cs.fn_hm_prorata, cs.fn_hm_valores_derivados,
--    cs.fn_hm_sugestao_financeira e no TypeScript (lib/services/hm-ficha.ts,
--    app/hm/_components/hm-drawer.tsx). Nao afetam o caso corrigido (o ramo
--    entrada_pacote vence antes), mas continuam sendo divida.
-- 2. cs.fn_hm_recalcular_financeiro nao filtra por produto (select into + update por
--    comprador_id): escreve nos DOIS cards de quem tem HM e AURUM. Trava backfill em massa.
-- 3. cs.fn_hm_prorata recebe so comprador_id, sem produto — mesmo problema de escopo.
