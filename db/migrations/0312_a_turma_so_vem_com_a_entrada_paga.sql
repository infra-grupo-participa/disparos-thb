-- =====================================================================
-- 0312_a_turma_so_vem_com_a_entrada_paga
--
-- ⚠️ NÃO APLICADA. Depende de fin.fn_turma_primeira_compra (repo sistema-grupo-participa-v2,
--    migration 20260929z87) — aplicar a z87 ANTES desta. Esta aborta sozinha se a função não existir.
--
-- ── A regra (Marcio, 29/09 — vinculante e RETROATIVA) ────────────────
-- 1. Quem pagou SÓ o sinal não é da base e NÃO tem turma. Entra na turma ao pagar a
--    parcela inicial (1ª parcela aprovada de saldo/diferença) OU a compra cheia.
--    A mensalidade do plano antigo (produto 3507214) NÃO conta.
-- 2. Quem já foi de turma passada NÃO ganha turma nova: fica com a PRIMEIRA turma dele.
-- B1 não mexe em grupo de WhatsApp — só o campo · B2 novato entra na turma da DATA DO SINAL
-- (o evento em que comprou); compra cheia = data da compra · B3 aluno antigo que só pagou o
-- sinal: card sem turma, turma antiga preservada na base · B4 parcela inicial = 1ª parcela
-- aprovada de saldo/diferença ou compra cheia · B5 estorno/chargeback da entrada → volta a
-- ficar sem turma. Tudo automático; nada por marcação manual.
--
-- ── O que havia (6 gravadores de cs.contatos_hm.turma, cada um com a sua regra) ─────
--   fn_seed_contato_hm ......... turma pela data da venda, INCLUSIVE só sinal
--   fn_tag_hm_origem ........... turma_origem pela base (com o remendo nullif(turma atual)) e
--                                etiqueta "Turma <turma ATUAL>" para quem tem aluno_id
--   fn_hm_provisionar_aluno .... origem > aluno > turma atual; reescreve card e etiqueta
--   fn_hm_cadastrar_manual ..... 'T39' fixo quando a tela não manda turma
--   edição manual (ficha/tabela) e script do Financeiro (z25)
-- Medido 29/09: 343 cards HM, TODOS com turma; 170 sem entrada paga (133 só sinal, 18 boleto
-- nunca pago, 17 reembolsados, 2 com sinal aprovado fora do razão); 100 com turma ≠ turma de
-- origem do Financeiro (fin.vw_turma_origem_card). Sobreposição: 63 dos 100 estão entre os 170.
--
-- ── O que passa a haver: UM gravador ────────────────────────────────
--   cs.fn_hm_turma_calcular(comprador, turma_origem) — a regra, num lugar só:
--       sem entrada paga → null · com entrada e origem → origem · novato → turma da data do
--       último sinal até a 1ª entrada (sem sinal: data da compra)
--   cs.fn_hm_turma_origem_calcular(comprador, criado_em) — a primeira turma de quem já foi
--       aluno: a MAIS ANTIGA entre a base anterior ao card (sem as linhas que o próprio fluxo
--       do Programa cria) e a primeira compra HM/AURUM antes do marco (fin.fn_turma_primeira_compra)
--   gatilho trg_hm_turma_regra (BEFORE INSERT/UPDATE OF turma, turma_origem, tags, comprador_id,
--       produto em cs.contatos_hm, só card HM): calcula turma_origem 1x quando vazia, recalcula a
--       turma e a etiqueta "Turma X". Quem grava turma à mão é sobrescrito; quem grava
--       turma_origem (correção administrativa em app/api/hm/contato/[id]/admin) é RESPEITADO.
--   gatilho trg_hm_turma_pagamento em cs.hm_pagamentos: pagamento lançado/estornado recalcula
--       (o estorno da Hotmart apaga a linha do razão — fn_hm_estornar_pagamento — e cai aqui: B5)
--   gatilho trg_hm_turma_timeline: toda troca de turma vira linha na timeline do card
--   cs.fn_hm_turma_conciliar(): conciliação diária (cron hm-turma-conciliar-diaria, 06:35 UTC) —
--       corrige card e a linha da base criada pelo próprio fluxo do Programa
--   patches com guarda (md5 do corpo vivo) em fn_tag_hm_origem, fn_hm_provisionar_aluno e
--       fn_hm_liberar_acesso: passam a ler a turma do card, e a "turma vigente" deixa de ser chute.
--   chave: cs.hm_config.turma_automatica (false desliga tudo acima sem deploy).
--
-- ── Duas medições que mudam a leitura da regra ────────────────────────
-- (a) "mensalidade" no razão NÃO é o plano antigo. cs.fn_hm_natureza_pagamento chama de
--     'mensalidade' a diferença paga em HOTMART_INSTALLMENTS ou oferta recorrente (produto
--     5064314/3094405). O plano antigo (3507214) nunca chega ao razão (fn_hm_lancar_compra só
--     lança sinal/diferenca/compra_cheia). Medido: 35 cards pagaram o sinal e depois o saldo SÓ
--     assim — se 'mensalidade' fosse excluída, 35 pessoas pagando o saldo perderiam a turma.
--     Esta migration conta. Sinal + só plano antigo (3507214): 2 cards → ficam sem turma.
-- (b) 6qxsk9kq (Acesso ETHB, R$ 2.497 fechado, "comprador é quitado") está no catálogo como
--     'sinal' só para liberar a trilha. Conta como compra cheia: 4 cards, 3 manteriam turma.
--
-- ── AS 5 PERGUNTAS ─────────────────────────────────────────────────────
-- 1. Escala: custo por CARD (um comprador), nunca por base. Leituras por índice:
--    hm_pagamentos_comprador_ix, idx_compras_comprador_id, hm_comprador_alias_canonico_ix,
--    thb_alunos_comprador_uidx / idx_thb_alunos_email_lower (predicado repete o da parcial),
--    fin.hotmart_transacoes_email_idx. A conciliação diária é por base (343 cards) — 1x/dia.
-- 2. Índice: explain (analyze, buffers) colado no fim deste cabeçalho.
-- 3. Frequência: gatilho só dispara em INSERT e em UPDATE que liste turma/turma_origem/tags/
--    comprador_id/produto (dezenas por dia: seed, tag de origem, provisionamento, tela). Por
--    pagamento: 1 recálculo por linha do razão (~5/dia). Cron: 1x/dia.
-- 4. Repetição: nenhuma tela chama as funções; leem a coluna gravada.
-- 5. Reversão: `update cs.hm_config set turma_automatica = false` (sem deploy) desliga gatilho,
--    recálculo e cron; os gravadores antigos voltam a valer (os patches têm o ramo legado).
--    Os valores anteriores ficam em cs.hm_turma_foto_0312 / cs.hm_turma_foto_0312_base —
--    restauração: update … from foto (ver o fim do arquivo).
--
-- ── MEDIÇÕES (29/09, produção, esta migration inteira rodada em begin…rollback) ──
--   Gatilho, 1 card (explain (analyze, buffers) update cs.contatos_hm set turma = turma where id = …):
--     Index Scan using contatos_hm_pkey · Buffers: shared hit=74 · Trigger trg_hm_turma_regra: time=1.785 calls=1
--     Execution Time: 2.162 ms (os outros gatilhos da tabela somam 0,2 ms)
--   fin.fn_turma_primeira_compra (dentro do gatilho): Index Scan em hotmart_transacoes_email_idx, 0,2 ms (ver z87).
--   Conciliação (retroativo): {"cards": 292, "base": 32} em 2.048 ms · 2ª rodada: {"cards": 0, "base": 0} em 719 ms
--     (idempotente; o cron diário custa ~0,7 s/dia).
--   SIMULAÇÃO do retroativo (343 cards HM):
--     perdem a turma 170  = 133 só sinal + 18 boleto nunca pago + 17 reembolsados/chargeback + 2 com sinal aprovado
--                           que nunca chegou ao razão
--                           por estágio: aguardando_retorno 62 · reuniao_finalizada 36 · solicitou_cancelamento 28 ·
--                           reembolsado 19 · boleto_gerado 18 · reuniao_agendada 6 · aguardando_pagamento 1
--                           desses, 117 já foram alunos (turma_origem fica gravada — B3), 4 têm aluno_id, 5 tinham etiqueta Turma
--     trocam de turma 39   (ex.: T40→T15 3, T39→T12 3, T40→T39 2, T41→T16 2 … — quem já foi aluno volta à primeira turma)
--     mantêm 134 · ganham 0 · turma_origem preenchida agora 135 · etiqueta "Turma" corrigida em 97 cards
--     com turma depois: 173 (145 pela origem, 28 novatos pela data do evento)
--     invariantes pós-aplicação: com turma sem entrada 0 · com entrada sem turma 0
--     timeline: 209 linhas "Turma: X → Y" (autor migration-0312)
--   Os 100 divergentes do Financeiro: 63 perdem a turma (só sinal), 37 passam a bater. Sobram 2 divergências entre os
--     173 com turma (T39 no card × T40 no Financeiro: novato cujo sinal caiu na janela da T39 do thb_turmas; o Financeiro
--     ecoava a turma antiga do card) — a z88 elimina a segunda leitura.
--   Base (thb_alunos das fontes do fluxo): 32 linhas acompanham a turma do card (10 T42→T41, 3 T39→T12, 2 T40→T5, …).
--   turma_origem JÁ preenchida que diverge do cálculo: 12 (ex.: T31 × T15, T36 × T15, 5× T29.2 × T29) — MANTIDAS
--     (podem ser correção administrativa); lista no relatório para o Marcio decidir.
--   Ensaios de comportamento (todos em begin…rollback):
--     fn_hm_cadastrar_manual(…, p_turma null) → card nasce SEM turma (o 'T39' fixo é sobrescrito), tags ["Aluno novo"]
--     aluno antigo só sinal (origem T15): sem turma → lança saldo → T15 → provisionar grava thb_alunos T15 →
--       liberar grava hm_liberacoes T15 → estorno (delete do razão) → sem turma. Timeline registrou as 3 trocas.
--     edição manual turma='T12' → sobrescrita (null); com turma_automatica=false → 'T12' fica.
--     correção administrativa turma_origem='T7' em card com entrada (6qxsk9kq) → turma T7 (respeitada).
-- =====================================================================

do $pre$
begin
  if to_regprocedure('fin.fn_turma_primeira_compra(text)') is null then
    raise exception '0312: fin.fn_turma_primeira_compra(text) não existe — aplicar antes a 20260929z87 do repo sistema-grupo-participa-v2';
  end if;
end $pre$;

-- ── 1. Chave de desligar ────────────────────────────────────────────────
alter table cs.hm_config add column if not exists turma_automatica boolean not null default true;
comment on column cs.hm_config.turma_automatica is
  '0312: regra de turma de 29/09 (só entra na turma quem pagou a entrada; quem já foi aluno fica com a primeira turma). false = desliga o gatilho, o recálculo por pagamento e a conciliação diária; os gravadores antigos voltam a valer.';

create or replace function cs.fn_hm_turma_ligada()
returns boolean language sql stable security definer set search_path = cs, public, pg_temp as $$
  select coalesce((select c.turma_automatica from cs.hm_config c where c.id = 1), true);
$$;

-- ── 2. A regra ──────────────────────────────────────────────────────────
-- Primeira entrada paga do card HM (null = só sinal, ou nada pago). Olha o razão E as compras
-- aprovadas: dentro do gatilho de public.compras o razão ainda não recebeu a linha
-- (trg_seed_contato_hm roda antes de trg_z_hm_compra_para_razao); a compra já está visível.
-- volatile: fn_hm_pagamento_do_produto → fn_hm_produto_da_oferta grava cache.
create or replace function cs.fn_hm_turma_entrada(p_comprador_id uuid, out entrada_em timestamptz, out compra_em timestamptz)
language sql volatile security definer set search_path = cs, public, pg_temp as $$
  select min(x.aprovado), min(x.comprado) from (
    select p.pago_em aprovado, p.pago_em comprado
      from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
       and p.categoria in ('saldo','compra_cheia','mensalidade')   -- 'mensalidade' = saldo parcelado, ver (a)
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, 'HM')
    union all
    select coalesce(c.data_aprovacao, c.data_compra), coalesce(c.data_compra, c.data_aprovacao)
      from public.compras c
      join public.hm_product_catalog k on k.offer_code = c.oferta_codigo
     where c.comprador_id in (select p_comprador_id
                              union all
                              select a.comprador_id from cs.hm_comprador_alias a where a.canonico_id = p_comprador_id)
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and (k.categoria in ('diferenca','compra_cheia') or c.oferta_codigo = '6qxsk9kq')   -- ver (b)
       and coalesce(c.produto_id, '') <> '3507214'                                         -- plano antigo nunca
       and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, 'HM')
  ) x;
$$;

-- Primeira turma de quem já foi aluno (regra 2). Vale a MAIS ANTIGA (menor thb_turmas.id — a
-- numeração segue a cronologia: T17R=18, T29.2=31, T42=58) entre:
--  (a) a base, só linha cadastrada ANTES do card e não criada pelo fluxo do Programa
--      (sip_sinal_trilha = acesso GPS do sinal; sip_ativacao_hm = provisionamento;
--       webhook_hotmart_hm = webhook antigo que gravava turma em qualquer compra);
--  (b) a primeira compra HM/AURUM antes do marco (fin.fn_turma_primeira_compra — z17/z87).
-- Null = novato.
create or replace function cs.fn_hm_turma_origem_calcular(p_comprador_id uuid, p_card_criado_em timestamptz)
returns text language plpgsql stable security definer set search_path = cs, public, pg_temp as $$
declare
  v_email text; v_base text; v_base_id int; v_fin text; v_fin_id int;
begin
  if p_comprador_id is null then return null; end if;
  select lower(trim(cp.email)) into v_email from public.compradores cp where cp.id = p_comprador_id;

  select t.codigo, t.id into v_base, v_base_id
    from public.thb_alunos a
    join public.thb_turmas t on t.id = a.turma_id and t.tipo = 'thb'
   where a.id in (select x.id from public.thb_alunos x where x.comprador_id = p_comprador_id
                  union
                  select x.id from public.thb_alunos x
                   where x.comprador_id in (select al.comprador_id from cs.hm_comprador_alias al
                                             where al.canonico_id = p_comprador_id)
                  union
                  select x.id from public.thb_alunos x
                   where coalesce(v_email, '') <> '' and x.email is not null and x.email <> ''
                     and lower(TRIM(BOTH FROM x.email)) = v_email)
     and coalesce(a.fonte, '') not in ('sip_sinal_trilha', 'sip_ativacao_hm', 'webhook_hotmart_hm')
     and a.importado_em < coalesce(p_card_criado_em, now())
   order by t.id
   limit 1;

  if coalesce(v_email, '') <> '' then
    select f.turma into v_fin from fin.fn_turma_primeira_compra(v_email) f;
    select t.id into v_fin_id from public.thb_turmas t where t.codigo = v_fin and t.tipo = 'thb' limit 1;
  end if;

  if v_base is null then return v_fin; end if;
  if v_fin is null then return v_base; end if;
  return case when coalesce(v_fin_id, 2147483647) < v_base_id then v_fin else v_base end;
end $$;

-- A turma do card HM — a regra num lugar só.
create or replace function cs.fn_hm_turma_calcular(p_comprador_id uuid, p_turma_origem text)
returns text language plpgsql volatile security definer set search_path = cs, public, pg_temp as $$
declare v_ent record; v_sinal timestamptz;
begin
  if p_comprador_id is null then return null; end if;
  select * into v_ent from cs.fn_hm_turma_entrada(p_comprador_id);
  if v_ent.entrada_em is null then return null; end if;                                   -- regra 1 / B3 / B5
  if nullif(btrim(p_turma_origem), '') is not null then return btrim(p_turma_origem); end if;  -- regra 2

  -- B2: o evento em que comprou = o último sinal pago até a 1ª entrada (15 cards têm sinais em
  -- turmas diferentes; o que levou à entrada é o último antes dela).
  select max(coalesce(c.data_compra, c.data_aprovacao)) into v_sinal
    from public.compras c
    join public.hm_product_catalog k on k.offer_code = c.oferta_codigo and k.categoria = 'sinal'
   where c.comprador_id in (select p_comprador_id
                            union all
                            select a.comprador_id from cs.hm_comprador_alias a where a.canonico_id = p_comprador_id)
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and c.oferta_codigo <> '6qxsk9kq'
     and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, 'HM')
     and coalesce(c.data_compra, c.data_aprovacao) <= v_ent.entrada_em;

  return cs.fn_hm_turma_por_data(coalesce(v_sinal, v_ent.compra_em));
end $$;

-- ── 3. O gravador único: gatilho BEFORE em cs.contatos_hm ──────────────
-- Nome começa com "trg_hm_t…": entre os BEFORE UPDATE da tabela roda por ÚLTIMO (ordem
-- alfabética: a_dono, b_congela, c_trava, revogacao, sync_responsavel, turma) — é a palavra final.
create or replace function cs.fn_hm_turma_regra()
returns trigger language plpgsql security definer set search_path = cs, public, pg_temp as $$
declare
  v_origem text; v_turma text; v_tags text[]; v_quero text[];
begin
  if coalesce(new.produto, 'HM') <> 'HM' or not cs.fn_hm_turma_ligada() then
    return new;
  end if;
  begin
    -- turma_origem: calculada 1x quando vazia. Preenchida (inclusive por correção administrativa) é respeitada.
    v_origem := nullif(btrim(new.turma_origem), '');
    if v_origem is null then
      v_origem := cs.fn_hm_turma_origem_calcular(new.comprador_id, coalesce(new.criado_em, now()));
    end if;
    v_turma := cs.fn_hm_turma_calcular(new.comprador_id, v_origem);

    -- etiqueta "Turma X" = a turma do card (sem turma, sem etiqueta). Só reescreve se estiver diferente,
    -- preservando a ordem das outras etiquetas.
    v_quero := case when v_turma is not null then array['Turma ' || v_turma] else '{}'::text[] end;
    v_tags  := coalesce(new.tags, '{}');
    if array(select x from unnest(v_tags) x where x ~ '^Turma ') is distinct from v_quero then
      v_tags := array(select x from unnest(v_tags) x where x !~ '^Turma ') || v_quero;
    end if;

    new.turma_origem := v_origem;
    new.turma := v_turma;
    new.tags := v_tags;
  exception when others then
    -- nunca derruba a gravação do card (o seed roda dentro do webhook da Hotmart); a conciliação diária corrige.
    -- Mas a falha também não pode virar porta dos fundos: turma e etiqueta "Turma X" ficam como
    -- estavam (INSERT: sem turma, sem etiqueta), nunca com o que o cliente mandou. As demais
    -- etiquetas do cliente seguem — só as "Turma X" vêm do old.
    new.turma := case when tg_op = 'INSERT' then null else old.turma end;
    new.tags  := array(select x from unnest(coalesce(new.tags, '{}')) x where x !~ '^Turma ')
              || case when tg_op = 'INSERT' then '{}'::text[]
                      else array(select x from unnest(coalesce(old.tags, '{}')) x where x ~ '^Turma ') end;
    raise warning '0312: regra de turma falhou no card % (%): %', new.id, new.comprador_id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_hm_turma_regra on cs.contatos_hm;
create trigger trg_hm_turma_regra
  before insert or update of turma, turma_origem, tags, comprador_id, produto on cs.contatos_hm
  for each row execute function cs.fn_hm_turma_regra();

-- ── 4. Timeline: toda troca de turma fica registrada no card ────────────
create or replace function cs.fn_hm_turma_timeline()
returns trigger language plpgsql security definer set search_path = cs, public, pg_temp as $$
begin
  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (new.id, 'sistema',
          'Turma: ' || coalesce(old.turma, 'sem turma') || ' → ' || coalesce(new.turma, 'sem turma') || ' — ' ||
          case when new.turma is null then 'sem pagamento de entrada (só o sinal não dá turma)'
               when new.turma = new.turma_origem then 'já foi aluno: fica com a primeira turma'
               else 'turma do evento em que comprou (data do sinal ou da compra cheia)' end ||
          ' · regra de 29/09',
          coalesce(nullif(current_setting('cs.hm_turma_autor', true), ''), 'sistema'));
  return null;
exception when others then
  raise warning '0312: timeline de turma falhou no card %: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_hm_turma_timeline on cs.contatos_hm;
create trigger trg_hm_turma_timeline
  after update on cs.contatos_hm
  for each row when (old.turma is distinct from new.turma and coalesce(new.produto, 'HM') = 'HM')
  execute function cs.fn_hm_turma_timeline();

-- ── 5. Pagamento lançado/estornado recalcula (B4/B5) ────────────────────
create or replace function cs.fn_hm_turma_pagamento()
returns trigger language plpgsql security definer set search_path = cs, public, pg_temp as $$
declare v_c uuid;
begin
  if not cs.fn_hm_turma_ligada() then return null; end if;
  for v_c in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.comprador_id end,
      case when tg_op <> 'DELETE' then new.comprador_id end]) x where x is not null
  loop
    begin
      update cs.contatos_hm ch
         set turma = ch.turma, atualizado_em = now()        -- o gatilho BEFORE recalcula
       where ch.comprador_id = v_c
         and coalesce(ch.produto, 'HM') = 'HM'
         and ch.turma is distinct from cs.fn_hm_turma_calcular(ch.comprador_id,
               coalesce(nullif(btrim(ch.turma_origem), ''), cs.fn_hm_turma_origem_calcular(ch.comprador_id, ch.criado_em)));
    exception when others then
      -- não derruba o lançamento/estorno (fn_hm_compra_cancelada engole erro e perderia o estorno inteiro)
      raise warning '0312: recálculo de turma falhou para o comprador %: %', v_c, sqlerrm;
    end;
  end loop;
  return null;
end $$;

drop trigger if exists trg_hm_turma_pagamento on cs.hm_pagamentos;
create trigger trg_hm_turma_pagamento
  after insert or update of comprador_id, categoria, oferta_codigo or delete on cs.hm_pagamentos
  for each row execute function cs.fn_hm_turma_pagamento();

-- ── 6. Conciliação (cron diário e aplicação retroativa) ─────────────────
-- Card: só os que divergem da regra (turma, etiqueta ou origem ainda não calculada).
-- Base: a linha de public.thb_alunos criada pelo PRÓPRIO fluxo do Programa (sip_sinal_trilha,
-- sip_ativacao_hm, webhook_hotmart_hm) acompanha a turma do card quando ele tem turma. A base
-- curada (planilhas, central) nunca é tocada — B3.
create or replace function cs.fn_hm_turma_conciliar()
returns jsonb language plpgsql security definer set search_path = cs, public, pg_temp as $$
declare v_cards int := 0; v_base int := 0;
begin
  if not cs.fn_hm_turma_ligada() then
    return jsonb_build_object('ligada', false);
  end if;

  with calc as (
    select ch.id, ch.turma, ch.tags,
           coalesce(nullif(btrim(ch.turma_origem), ''), cs.fn_hm_turma_origem_calcular(ch.comprador_id, ch.criado_em)) origem,
           nullif(btrim(ch.turma_origem), '') is null origem_vazia
      from cs.contatos_hm ch
     where coalesce(ch.produto, 'HM') = 'HM'
  ), alvo as (
    select c.id from calc c
     cross join lateral (select cs.fn_hm_turma_calcular(ch.comprador_id, c.origem) t
                           from cs.contatos_hm ch where ch.id = c.id) q
     where c.turma is distinct from q.t
        or (c.origem_vazia and c.origem is not null)
        or array(select x from unnest(coalesce(c.tags, '{}')) x where x ~ '^Turma ')
             is distinct from case when q.t is not null then array['Turma ' || q.t] else '{}'::text[] end
  )
  update cs.contatos_hm ch set turma = ch.turma, atualizado_em = now()   -- o gatilho BEFORE recalcula
    from alvo where ch.id = alvo.id;
  get diagnostics v_cards = row_count;

  update public.thb_alunos a
     set turma_id = t.id, atualizado_em = now()
    from cs.contatos_hm ch
    join public.thb_turmas t on t.codigo = ch.turma and t.tipo = 'thb'
   where coalesce(ch.produto, 'HM') = 'HM'
     and ch.turma is not null
     and a.id = coalesce(ch.aluno_id, (select x.id from public.thb_alunos x where x.comprador_id = ch.comprador_id limit 1))
     and a.fonte in ('sip_sinal_trilha', 'sip_ativacao_hm', 'webhook_hotmart_hm')
     and a.turma_id is distinct from t.id;
  get diagnostics v_base = row_count;

  return jsonb_build_object('ligada', true, 'cards', v_cards, 'base', v_base);
end $$;

-- ── 7. Os gravadores antigos passam a ler a turma do card (patch com guarda sobre o corpo VIVO) ──
do $patch$
declare v text; v_md5 text;
begin
  -- 7a. fn_tag_hm_origem: deixa de CALCULAR a turma de origem (o gatilho calcula); lê a do card.
  v := pg_get_functiondef('cs.fn_tag_hm_origem(uuid)'::regprocedure);
  if position('0312' in v) = 0 then
    v_md5 := md5(v);
    if v_md5 <> '923dc81e3af92fb7deba1f39be25872d' then
      raise exception '0312: cs.fn_tag_hm_origem mudou desde a medição (md5 %) — reler o corpo vivo antes de aplicar', v_md5;
    end if;
    v := replace(v,
$a$  select ch.id, ch.tags, ch.observacoes, ch.turma_origem, ch.aluno_id,$a$,
$b$  select ch.id, ch.produto, ch.tags, ch.observacoes, ch.turma_origem, ch.aluno_id,$b$);
    v := replace(v,
$a$    v_turma_thb := coalesce(v_card.turma_origem, nullif(nullif(trim(al.turma_codigo),''), cs.fn_hm_turma_atual()));$a$,
$b$    -- 0312: card HM tem UM gravador de turma/turma_origem (gatilho trg_hm_turma_regra). Toca a
    -- coluna para o gatilho calcular e lê o resultado; os updates de turma abaixo passam pelo
    -- gatilho e são recalculados. Chave desligada ou card de outro board: regra antiga.
    if coalesce(v_card.produto, 'HM') = 'HM' and cs.fn_hm_turma_ligada() then
      update cs.contatos_hm set turma_origem = turma_origem where id = v_card.id
      returning turma_origem into v_turma_thb;
    else
      v_turma_thb := coalesce(v_card.turma_origem, nullif(nullif(trim(al.turma_codigo),''), cs.fn_hm_turma_atual()));
    end if;$b$);
    if position('0312' in v) = 0 or position('ch.produto, ch.tags' in v) = 0 then
      raise exception '0312: patch de cs.fn_tag_hm_origem não casou';
    end if;
    execute v;
  end if;

  -- 7b. fn_hm_provisionar_aluno: a turma do aluno é a turma do card; turma vigente deixa de ser chute.
  v := pg_get_functiondef('cs.fn_hm_provisionar_aluno(uuid,numeric,numeric)'::regprocedure);
  if position('0312' in v) = 0 then
    v_md5 := md5(v);
    if v_md5 <> '6ac1a543b8c422515b7460bc746e7cc4' then
      raise exception '0312: cs.fn_hm_provisionar_aluno mudou desde a medição (md5 %) — reler o corpo vivo antes de aplicar', v_md5;
    end if;
    v := replace(v,
$a$  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra$a$,
$b$  -- 0312: com a regra ligada, a turma do aluno é a turma do card HM (entrada paga → origem ou
  -- turma do evento; só sinal → nenhuma) e a turma vigente nunca entra como chute.
  if cs.fn_hm_turma_ligada() then
    v_turma_atual := null;
    v_turma_orig := null;
    select t.id into v_turma_orig
      from cs.contatos_hm ch
      join public.thb_turmas t on t.tipo = 'thb'
       and t.codigo = cs.fn_hm_turma_calcular(ch.comprador_id,
             coalesce(nullif(btrim(ch.turma_origem), ''), cs.fn_hm_turma_origem_calcular(ch.comprador_id, ch.criado_em)))
     where ch.comprador_id = p_comprador_id and coalesce(ch.produto, 'HM') = 'HM'
     limit 1;
  end if;

  select min(coalesce(c.data_aprovacao, c.data_compra)) into v_data_compra$b$);
    if position('0312' in v) = 0 then
      raise exception '0312: patch de cs.fn_hm_provisionar_aluno não casou';
    end if;
    execute v;
  end if;

  -- 7c. fn_hm_liberar_acesso: a turma gravada em hm_liberacoes é a do card; sem turma vigente por chute.
  v := pg_get_functiondef('cs.fn_hm_liberar_acesso(uuid)'::regprocedure);
  if position('0312' in v) = 0 then
    v_md5 := md5(v);
    if v_md5 <> '17457ece46145a7f01d93191366c5738' then
      raise exception '0312: cs.fn_hm_liberar_acesso mudou desde a medição (md5 %) — reler o corpo vivo antes de aplicar', v_md5;
    end if;
    v := replace(v,
$a$  select a.turma_id into v_turma from public.thb_alunos a where a.id = v_aluno_id;
  if v_turma is null then
    select id into v_turma from public.thb_turmas where atual and tipo = 'thb' limit 1;
  end if;$a$,
$b$  select a.turma_id into v_turma from public.thb_alunos a where a.id = v_aluno_id;
  if cs.fn_hm_turma_ligada() then
    -- 0312: turma do card HM manda; card sem turma (só sinal) fica com a da base (B3), nunca com a vigente.
    select coalesce((select t.id from cs.contatos_hm ch
                       join public.thb_turmas t on t.codigo = ch.turma and t.tipo = 'thb'
                      where ch.comprador_id = p_comprador_id and coalesce(ch.produto, 'HM') = 'HM'
                      limit 1), v_turma)
      into v_turma;
  elsif v_turma is null then
    select id into v_turma from public.thb_turmas where atual and tipo = 'thb' limit 1;
  end if;$b$);
    if position('0312' in v) = 0 then
      raise exception '0312: patch de cs.fn_hm_liberar_acesso não casou';
    end if;
    execute v;
  end if;
end $patch$;

revoke all on function cs.fn_hm_turma_ligada() from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_entrada(uuid) from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_origem_calcular(uuid, timestamptz) from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_calcular(uuid, text) from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_regra() from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_timeline() from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_pagamento() from public, anon, authenticated;
revoke all on function cs.fn_hm_turma_conciliar() from public, anon, authenticated;

-- ── 8. Aplicação retroativa, com foto e trava ──────────────────────────
create table if not exists cs.hm_turma_foto_0312 (
  card_id uuid primary key,
  turma_antes text, turma_origem_antes text, tags_antes text[],
  turma_depois text, turma_origem_depois text, tags_depois text[],
  fotografado_em timestamptz not null default now()
);
create table if not exists cs.hm_turma_foto_0312_base (
  aluno_id uuid primary key,
  turma_id_antes smallint, turma_id_depois smallint,
  fotografado_em timestamptz not null default now()
);
alter table cs.hm_turma_foto_0312 enable row level security;
alter table cs.hm_turma_foto_0312_base enable row level security;
revoke all on cs.hm_turma_foto_0312, cs.hm_turma_foto_0312_base from public, anon, authenticated;

insert into cs.hm_turma_foto_0312 (card_id, turma_antes, turma_origem_antes, tags_antes)
select id, turma, turma_origem, tags from cs.contatos_hm where coalesce(produto, 'HM') = 'HM'
on conflict (card_id) do nothing;

insert into cs.hm_turma_foto_0312_base (aluno_id, turma_id_antes)
select a.id, a.turma_id from public.thb_alunos a
 where a.fonte in ('sip_sinal_trilha', 'sip_ativacao_hm', 'webhook_hotmart_hm')
on conflict (aluno_id) do nothing;

do $retro$
declare
  r jsonb; v_perde int; v_troca int; v_ganha int; v_sem_ent_com_turma int; v_com_ent_sem_turma int; v_origem int;
begin
  perform set_config('cs.hm_turma_autor', 'migration-0312', true);
  r := cs.fn_hm_turma_conciliar();

  update cs.hm_turma_foto_0312 f
     set turma_depois = ch.turma, turma_origem_depois = ch.turma_origem, tags_depois = ch.tags
    from cs.contatos_hm ch where ch.id = f.card_id;
  update cs.hm_turma_foto_0312_base f
     set turma_id_depois = a.turma_id
    from public.thb_alunos a where a.id = f.aluno_id;

  select count(*) filter (where turma_antes is not null and turma_depois is null),
         count(*) filter (where turma_antes is not null and turma_depois is not null and turma_antes <> turma_depois),
         count(*) filter (where turma_antes is null and turma_depois is not null),
         count(*) filter (where turma_origem_antes is null and turma_origem_depois is not null)
    into v_perde, v_troca, v_ganha, v_origem
    from cs.hm_turma_foto_0312;

  -- Invariantes: turma ⇔ entrada paga, em TODO card HM.
  select count(*) filter (where ch.turma is not null and e.entrada_em is null),
         count(*) filter (where ch.turma is null and e.entrada_em is not null)
    into v_sem_ent_com_turma, v_com_ent_sem_turma
    from cs.contatos_hm ch cross join lateral cs.fn_hm_turma_entrada(ch.comprador_id) e
   where coalesce(ch.produto, 'HM') = 'HM';

  raise notice '0312 retro: % | perdem turma % · trocam % · ganham % · origem preenchida % | invariantes: com turma sem entrada %, com entrada sem turma %',
    r, v_perde, v_troca, v_ganha, v_origem, v_sem_ent_com_turma, v_com_ent_sem_turma;

  if v_sem_ent_com_turma <> 0 or v_com_ent_sem_turma <> 0 then
    raise exception '0312: invariante violada (com turma sem entrada %, com entrada sem turma %) — abortado', v_sem_ent_com_turma, v_com_ent_sem_turma;
  end if;
  -- Medido no ensaio de 29/09 (343 cards): perdem 170 · trocam 39 · origem preenchida 135.
  -- Folga de ±10 para vendas/pagamentos que entrarem entre a medição e a aplicação.
  if v_perde not between 160 and 180 or v_troca not between 29 and 49 or v_origem not between 125 and 145 then
    raise exception '0312: totais fora do medido (perdem % [160–180], trocam % [29–49], origem % [125–145]) — remedir antes de aplicar',
      v_perde, v_troca, v_origem;
  end if;
end $retro$;

-- ── 9. Cron diário ──────────────────────────────────────────────────────
select cron.unschedule('hm-turma-conciliar-diaria') where exists (select 1 from cron.job where jobname = 'hm-turma-conciliar-diaria');
select cron.schedule('hm-turma-conciliar-diaria', '35 6 * * *', $$ select cs.fn_hm_turma_conciliar(); $$);

-- ── Reversão ───────────────────────────────────────────────────────────
--   update cs.hm_config set turma_automatica = false;                       -- desliga tudo, sem deploy
--   select cron.unschedule('hm-turma-conciliar-diaria');
--   update cs.contatos_hm ch set turma = f.turma_antes, turma_origem = f.turma_origem_antes, tags = f.tags_antes
--     from cs.hm_turma_foto_0312 f where f.card_id = ch.id;                  -- (com a chave desligada)
--   update public.thb_alunos a set turma_id = f.turma_id_antes
--     from cs.hm_turma_foto_0312_base f where f.aluno_id = a.id and f.turma_id_depois is distinct from f.turma_id_antes;
