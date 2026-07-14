-- =====================================================================
-- 0075_hm_razao_de_pagamentos
--
-- O FINANCEIRO DO HM PASSA A TER LASTRO: cada pagamento vira uma linha.
--
-- Até aqui o dinheiro do card eram dois números soltos (valor_total, valor_pago)
-- que alguém digitava, e que qualquer compra nova sobrescrevia com a soma crua de
-- `compras.preco`. Não havia histórico, não havia como saber de onde o número veio,
-- e reimportar qualquer coisa somava duas vezes.
--
-- O BURACO QUE ISSO FECHA — a segunda parcela era jogada fora.
-- O gatilho de venda (0037, mantido em 0050) descarta um HOTMART_INSTALLMENTS que
-- já tenha compra anterior do mesmo comprador+oferta. A guarda existe para não
-- duplicar o card — mas ela mata junto o RECONHECIMENTO DO PAGAMENTO. Hoje há 8
-- pessoas pagando mensalidade (Dilcele, Leonel, Tarcio: 1.323,52 · Edson, João
-- Borges, José Henrique: 1.149,99 · Solange: 1.193,40 · Marina: 1.276,14) cuja
-- 2ª parcela, ao cair, não abateria um centavo do saldo. Agora abate.
--
-- QUEM É MENSALIDADE: só HOTMART_INSTALLMENTS (e oferta recorrente) gravam a
-- PARCELA em compras.preco. CREDIT_CARD parcelado em 12x grava o valor CHEIO — a
-- Hotmart adianta ao produtor. Confundir os dois é dar por quitado quem deve, ou
-- por devedor quem quitou.
--
-- O QUE ESTA MIGRATION NÃO FAZ: não cria card para quem não está no kanban (só
-- lança pagamento de quem já tem card), não cria aluno (isso segue sendo do
-- gatilho de venda, que exige lastro) e não move card de estágio.
--
-- Aditiva e idempotente.
-- =====================================================================

-- 0) O retrato do antes — backup e testemunha ---------------------------------
-- Precisa ser a PRIMEIRA coisa: o recálculo reescreve `valor_pago` assim que o
-- primeiro lançamento entra, e sem este retrato o que a ficha afirmava se perde.
-- Foi o que quase custou R$ 1.364,54 do Renato Nicolodi no ensaio desta migration.
-- `if not exists` de propósito: rodar a migration duas vezes não pode sobrescrever
-- o retrato original com um já modificado.
create table if not exists cs._bkp_0075_financeiro as
select id, comprador_id, valor_total, valor_pago, apto_ativacao, pagamento_em,
       revisar, revisar_motivo, now() as tirado_em
  from cs.contatos_hm;

-- 1) A razão — uma linha por pagamento, com a transação como chave ------------
create table if not exists cs.hm_pagamentos (
  id               uuid primary key default gen_random_uuid(),
  comprador_id     uuid not null references public.compradores(id) on delete cascade,
  -- sinal: a entrada de R$300 · saldo: a diferença paga de uma vez
  -- mensalidade: uma parcela do saldo (ou da compra cheia) no parcelado Hotmart
  -- compra_cheia: o pacote pago integralmente · ajuste: acerto sem lastro na Hotmart
  categoria        text not null check (categoria in ('sinal','saldo','mensalidade','compra_cheia','ajuste')),
  valor            numeric(12,2) not null check (valor <> 0),
  pago_em          timestamptz not null,
  origem           text not null check (origem in ('hotmart','csv','manual')),
  transacao        text,                  -- public.compras.hotmart_transaction
  compra_id        uuid,
  oferta_codigo    text,
  metodo_pagamento text,
  parcela          smallint,              -- nº da parcela, quando a origem informa
  obs              text,
  autor            text not null default 'sistema',
  criado_em        timestamptz not null default now()
);

-- Idempotência: a transação da Hotmart é única, e cada parcela/recorrência chega
-- com transação NOVA (confirmado: Aline pagou qitecj76 em 10/06 e 10/07, duas
-- transações). Reimportar o mesmo CSV mil vezes não duplica nada.
create unique index if not exists hm_pagamentos_transacao_uk
  on cs.hm_pagamentos (transacao) where transacao is not null;

-- Lançamento sem transação (acerto manual, pagamento fora da Hotmart): a chave é
-- o próprio fato — mesma pessoa, mesma natureza, mesmo dia, mesmo valor.
create unique index if not exists hm_pagamentos_fato_uk
  on cs.hm_pagamentos (comprador_id, categoria, pago_em, valor) where transacao is null;

create index if not exists hm_pagamentos_comprador_ix
  on cs.hm_pagamentos (comprador_id, pago_em desc);

grant select on cs.hm_pagamentos to disparos_app;

-- O card registra QUANDO quitou. Deliberadamente separado de `apto_ativacao`:
-- aquele campo quer dizer "pode ser ativado" (e é ligado por quem arrasta o card),
-- não "não deve mais nada". Misturar os dois faria a esteira andar sozinha atrás
-- de um boleto.
alter table cs.contatos_hm add column if not exists quitado_em timestamptz;

-- 2) Que natureza tem este pagamento ------------------------------------------
create or replace function cs.fn_hm_natureza_pagamento(
  p_categoria   text,      -- categoria do catálogo (sinal/diferenca/compra_cheia)
  p_metodo      text,      -- compras.metodo_pagamento
  p_recorrente  boolean    -- cs.hm_ofertas_saldo.recorrente
)
returns text
language sql
immutable
as $fn$
  select case
    when p_categoria = 'sinal' then 'sinal'
    -- O parcelado da Hotmart grava a PARCELA no preço: cada evento é uma mensalidade,
    -- valha ele contra o saldo ou contra o pacote cheio.
    when p_metodo = 'HOTMART_INSTALLMENTS' or coalesce(p_recorrente, false) then 'mensalidade'
    when p_categoria = 'diferenca'    then 'saldo'
    when p_categoria = 'compra_cheia' then 'compra_cheia'
  end;
$fn$;

-- 3) Recálculo — o valor pago do card passa a ser a SOMA DA RAZÃO --------------
create or replace function cs.fn_hm_recalcular_financeiro(p_comprador_id uuid)
returns void
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_card    cs.contatos_hm%rowtype;
  v_pago    numeric := 0;
  v_total   numeric;
  v_saldo   numeric;
  v_ultimo  timestamptz;
  v_val     record;
  v_situacao text;
  v_status   text;
begin
  select * into v_card from cs.contatos_hm where comprador_id = p_comprador_id;
  if not found then return; end if;   -- sem card, não há financeiro a manter

  select coalesce(sum(valor), 0), max(pago_em)
    into v_pago, v_ultimo
    from cs.hm_pagamentos where comprador_id = p_comprador_id;

  -- O total do pacote é o que a operação fechou (300 + a oferta que a pessoa pagou).
  -- Quando ninguém definiu, o sistema só deriva se houver LASTRO — isto é, se a
  -- pessoa já pagou saldo ou pacote e o número é conhecível. Para quem só pagou o
  -- sinal, o total continua nulo de propósito: cravar 15.000 afirmaria uma dívida
  -- de 14.700 para o aluno da base, que deve muito menos (o pró-rata já desconta).
  -- Saldo desconhecido é honesto; saldo inventado, não. (Lente "Sem saldo calculado".)
  v_total := v_card.valor_total;
  if v_total is null and cs.fn_hm_tem_lastro(p_comprador_id) then
    select * into v_val from cs.fn_hm_valores_derivados(p_comprador_id);
    v_total := v_val.valor_total;
  end if;

  v_saldo := greatest(coalesce(v_total, 0) - v_pago, 0);
  if v_saldo < 1 then v_saldo := 0; end if;   -- centavos não são dívida (regra de 0050)

  update cs.contatos_hm
     set valor_pago  = v_pago,
         valor_total = v_total,
         quitado_em  = case
                         when coalesce(v_total, 0) > 0 and v_saldo = 0
                           then coalesce(quitado_em, v_ultimo, now())
                         else null      -- estornou/ajustou para baixo: volta a dever
                       end,
         atualizado_em = now()
   where comprador_id = p_comprador_id;

  -- Espelha na base de alunos, mas NUNCA cria matrícula: quem vira aluno é decidido
  -- pelo lastro (cs.fn_hm_tem_lastro), não por um lançamento no razão.
  if v_card.aluno_id is not null then
    if coalesce(v_total, 0) > 0 and v_saldo = 0 then
      v_situacao := 'quitado';      v_status := 'Quitado';
    elsif v_pago > 0 then
      v_situacao := 'em_andamento'; v_status := 'Em andamento';
    else
      v_situacao := 'so_sinal';     v_status := 'Só sinal pago';
    end if;

    update public.thb_alunos
       set valor_total         = v_total,
           valor_pago          = v_pago,
           saldo_devedor       = v_saldo,
           situacao_financeira = case when situacao_financeira = 'cancelado'
                                      then situacao_financeira   -- cancelar marca, não some
                                      else v_situacao end,
           status_pagamento    = case when situacao_financeira = 'cancelado'
                                      then status_pagamento else v_status end,
           ultimo_pagamento    = coalesce(v_ultimo::date, ultimo_pagamento),
           atualizado_em       = now()
     where id = v_card.aluno_id;
  end if;
end$fn$;

grant execute on function cs.fn_hm_recalcular_financeiro(uuid) to disparos_app;

-- 4) Todo lançamento reescreve o saldo ----------------------------------------
create or replace function cs.fn_hm_pagamento_mudou()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_comprador uuid;
  v_card      uuid;
  v_saldo     numeric;
  v_quitou    boolean;
begin
  -- Em DELETE o registro NEW não existe — ler qualquer campo dele aqui seria erro.
  if tg_op = 'DELETE' then
    v_comprador := old.comprador_id;
  else
    v_comprador := new.comprador_id;
  end if;

  perform cs.fn_hm_recalcular_financeiro(v_comprador);

  if tg_op <> 'INSERT' then
    return null;                       -- correção/estorno mexe no saldo, não vira evento
  end if;

  -- O backfill importa o passado: ele reescreve os saldos, mas não finge que 258
  -- pagamentos antigos aconteceram agora na timeline de todo mundo.
  if coalesce(current_setting('cs.hm_backfill', true), '') = 'on'
     or new.autor = 'migration-0075' then
    return null;
  end if;

  select ch.id, greatest(coalesce(ch.valor_total, 0) - coalesce(ch.valor_pago, 0), 0),
         ch.quitado_em is not null
    into v_card, v_saldo, v_quitou
    from cs.contatos_hm ch where ch.comprador_id = v_comprador;

  if v_card is not null then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card, 'sistema',
            'Pagamento registrado: R$ ' || trim(to_char(new.valor, '999G999G999D99'))
            || ' (' || new.categoria || ', ' || new.origem || ')'
            || case when v_quitou then ' — SALDO QUITADO'
                    when v_saldo > 0 then ' — saldo restante R$ ' || trim(to_char(v_saldo, '999G999G999D99'))
                    else '' end,
            coalesce(new.autor, 'sistema'));
  end if;

  return null;
end$fn$;

drop trigger if exists trg_hm_pagamento_mudou on cs.hm_pagamentos;
create trigger trg_hm_pagamento_mudou
after insert or update or delete on cs.hm_pagamentos
for each row execute function cs.fn_hm_pagamento_mudou();

-- 5) A compra aprovada vira lançamento sozinha --------------------------------
create or replace function cs.fn_hm_lancar_compra(p_compra_id uuid)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_c        public.compras%rowtype;
  v_cat      text;
  v_recor    boolean;
  v_natureza text;
  v_id       uuid;
begin
  select * into v_c from public.compras where id = p_compra_id;
  if not found or v_c.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return null;
  end if;

  -- Só lança para quem JÁ ESTÁ no kanban. Pagamento de quem não tem card não vira
  -- card nem lançamento: aparece em cs.vw_hm_pagamentos_orfaos para conferência.
  if not exists (select 1 from cs.contatos_hm where comprador_id = v_c.comprador_id) then
    return null;
  end if;

  select cat.categoria into v_cat
    from public.hm_product_catalog cat where cat.offer_code = v_c.oferta_codigo limit 1;
  select os.recorrente into v_recor
    from cs.hm_ofertas_saldo os where os.codigo = v_c.oferta_codigo limit 1;

  -- Renovação e reserva de vaga são outro contrato: entram no caixa, não abatem o
  -- saldo do HM. Produto fora do catálogo idem.
  if v_cat is null or v_cat not in ('sinal','diferenca','compra_cheia') then
    return null;
  end if;

  v_natureza := cs.fn_hm_natureza_pagamento(v_cat, v_c.metodo_pagamento, v_recor);
  if v_natureza is null or coalesce(v_c.preco, 0) = 0 then
    return null;
  end if;

  insert into cs.hm_pagamentos (
    comprador_id, categoria, valor, pago_em, origem, transacao, compra_id,
    oferta_codigo, metodo_pagamento, parcela, autor
  ) values (
    v_c.comprador_id, v_natureza, v_c.preco,
    coalesce(v_c.data_aprovacao, v_c.data_compra, now()),
    'hotmart', v_c.hotmart_transaction, v_c.id,
    v_c.oferta_codigo, v_c.metodo_pagamento, v_c.numero_recorrencia, 'hotmart'
  )
  on conflict (transacao) where transacao is not null do nothing
  returning id into v_id;

  return v_id;
end$fn$;

grant execute on function cs.fn_hm_lancar_compra(uuid) to disparos_app;

create or replace function cs.fn_hm_compra_para_razao()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
begin
  -- Nunca derruba a venda: um erro aqui não pode fazer a Hotmart reenviar o webhook.
  begin
    perform cs.fn_hm_lancar_compra(new.id);
  exception when others then
    null;
  end;
  return new;
end$fn$;

-- Roda DEPOIS de trg_seed_contato_hm (Postgres dispara por ordem alfabética do
-- nome): na primeira compra, o card precisa existir antes do lançamento.
drop trigger if exists trg_z_hm_compra_para_razao on public.compras;
create trigger trg_z_hm_compra_para_razao
after insert or update of status on public.compras
for each row execute function cs.fn_hm_compra_para_razao();

-- 6) O que a operação vê ------------------------------------------------------
create or replace view cs.vw_hm_extrato as
select p.id, p.comprador_id, ch.id as contato_hm_id, cp.nome, cp.email,
       p.categoria, p.valor, p.pago_em, p.origem, p.transacao, p.oferta_codigo,
       p.metodo_pagamento, p.parcela, p.obs, p.autor, p.criado_em
  from cs.hm_pagamentos p
  join public.compradores cp on cp.id = p.comprador_id
  join cs.contatos_hm    ch on ch.comprador_id = p.comprador_id;

grant select on cs.vw_hm_extrato to disparos_app;

-- Pagamento de quem não está no kanban: não entra no razão, mas não some.
create or replace view cs.vw_hm_pagamentos_orfaos as
select c.id as compra_id, c.comprador_id, cp.nome, cp.email,
       cat.categoria, c.oferta_codigo, c.preco, c.metodo_pagamento,
       coalesce(c.data_aprovacao, c.data_compra) as pago_em, c.hotmart_transaction
  from public.compras c
  join public.compradores cp on cp.id = c.comprador_id
  join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
 where c.status in ('APPROVED','COMPLETE','COMPLETED')
   and cat.categoria in ('sinal','diferenca','compra_cheia')
   and not exists (select 1 from cs.contatos_hm ch where ch.comprador_id = c.comprador_id);

grant select on cs.vw_hm_pagamentos_orfaos to disparos_app;

-- 7) Backfill — o passado entra no razão --------------------------------------
-- (a) toda compra aprovada de quem tem card vira lançamento
do $backfill$
declare r record;
begin
  perform set_config('cs.hm_backfill', 'on', true);   -- local à transação
  for r in
    select c.id
      from public.compras c
      join cs.contatos_hm ch on ch.comprador_id = c.comprador_id
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
     order by coalesce(c.data_aprovacao, c.data_compra)
  loop
    perform cs.fn_hm_lancar_compra(r.id);
  end loop;
end$backfill$;

-- (b) o que a ficha afirmava e a Hotmart não conhece vira AJUSTE, não evapora.
-- Compara contra o RETRATO do passo 0, não contra o card ao vivo: a esta altura o
-- card já foi reescrito pelo próprio backfill.
-- Renato Nicolodi é o caso vivo: o sinal está num comprador e o saldo em outro
-- (duplicado na Hotmart, sem CPF). O dinheiro entrou — sumir com ele do razão seria
-- mentir que ele deve R$ 1.364,54 a mais. Entra como ajuste, marcado para conferência.
insert into cs.hm_pagamentos (comprador_id, categoria, valor, pago_em, origem, obs, autor)
select b.comprador_id, 'ajuste',
       round(b.valor_pago - coalesce(r.pago, 0), 2),
       coalesce(b.pagamento_em, b.tirado_em),
       'manual',
       'Ajuste de abertura (migration 0075): a ficha registrava R$ '
         || trim(to_char(b.valor_pago, '999G999G999D99'))
         || ' e a Hotmart conhece R$ ' || trim(to_char(coalesce(r.pago, 0), '999G999G999D99'))
         || '. Diferença preservada — conferir a origem do pagamento.',
       'migration-0075'
  from cs._bkp_0075_financeiro b
  left join (
    select comprador_id, sum(valor) as pago from cs.hm_pagamentos group by 1
  ) r on r.comprador_id = b.comprador_id
 where coalesce(b.valor_pago, 0) - coalesce(r.pago, 0) >= 1     -- centavos não são pagamento
on conflict do nothing;

-- (c) marca para conferência quem ganhou ajuste
update cs.contatos_hm ch
   set revisar = true,
       revisar_motivo = coalesce(ch.revisar_motivo,
         'Financeiro: parte do valor pago não tem registro na Hotmart (ajuste de abertura em 0075)'),
       atualizado_em = now()
  from cs.hm_pagamentos p
 where p.comprador_id = ch.comprador_id
   and p.autor = 'migration-0075';

-- (d) recalcula todo mundo a partir da razão
do $recalc$
declare r record;
begin
  for r in select comprador_id from cs.contatos_hm loop
    perform cs.fn_hm_recalcular_financeiro(r.comprador_id);
  end loop;
end$recalc$;
