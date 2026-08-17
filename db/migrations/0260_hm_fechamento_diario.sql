-- 0260_hm_fechamento_diario.sql
--
-- B2/fechamento diário (16/08/2026) — o retrato que o amanhã NÃO consegue reconstruir.
--
-- Pedido do João: separar "o que eu faço agora" (kanban/agenda) de "como estamos no
-- período", com evolução no tempo. A maior parte da série de longo prazo NÃO precisa de
-- tabela nova — `cs.hm_pagamentos.pago_em` já dá "recebido por dia" exato, e
-- `cs.vw_hm_carteira.sinal_pago_em/quitado_em` já dão entradas e quitações. Reconstruir isso
-- todo dia num snapshot duplicaria o razão — e duplicar o razão é como se cria divergência de
-- dado, o inverso do que foi pedido.
--
-- O que genuinamente NÃO se reconstrói, e só isso entra aqui:
--
--   1) "quanto se tinha a receber no dia X". `cs.fn_hm_prorata` calcula o crédito com
--      CURRENT_DATE: o crédito encolhe e o saldo sobe todo dia. Medido em 16/08/2026:
--      73 pessoas, R$ 642.049,25 de crédito, ~R$ 1.110,94/dia de variação. Perguntar hoje
--      "quanto faltava em 01/08" devolveria um número que NUNCA existiu.
--   2) "de quem era a carteira no dia X". `cs.vw_hm_carteira` reconstrói pela linha do tempo
--      ATUAL, e a régua já mudou uma vez (0242 moveu Jusy 154→118, Jonathan 9→45).
--
-- Por isso esta tabela é pequena de propósito e carrega `regra_versao`: se a régua da
-- carteira mudar de novo, o dia antigo continua contando a história de COMO ela foi medida
-- naquele dia — nunca é sobrescrito.
--
-- BACKFILL: NENHUM, e é decisão, não preguiça. Não existe insumo para reconstruir
-- `a_receber` de ontem. A série COMEÇA em 16/08/2026 e enche daqui pra frente — a API expõe
-- `serie_estado_comeca_em` para a tela dizer isso, em vez de fingir histórico com zero.
--
-- APPEND-ONLY: lição literal da 0177 (achado do pentester). `alter default privileges` da
-- 0001 dá insert/update/delete a `disparos_app` em TODA tabela nova do schema `cs`. Sem o
-- `revoke` abaixo, a prova seria reescrevível e não provaria nada.

create table if not exists cs.hm_fechamento_diario (
  dia                  date not null,
  produto              text not null,
  carteira_usuario_id  uuid null,           -- null = "sem dono identificado" naquele dia
  -- coluna gerada para a PK: expressão em índice de PK depende de versão do Postgres, uma
  -- coluna STORED é portável em qualquer versão suportada pelo Supabase.
  carteira_key         uuid generated always as (
                          coalesce(carteira_usuario_id, '00000000-0000-0000-0000-000000000000'::uuid)
                        ) stored,
  carteira_nome        text,                -- congelado: se a pessoa mudar de nome, a série não se desliga
  regra_versao         text not null,       -- 'vw_hm_carteira@0253'; muda quando a régua da carteira mudar
  alunos               int  not null,
  quitados             int  not null,
  pagando              int  not null,       -- status in ('parcelando','pagando_parcial')
  so_entrada           int  not null,
  cancelados           int  not null,       -- status in ('cancelado','entrada_estornada')
  recebido_no_ciclo    numeric(14,2) not null,
  a_receber            numeric(14,2) not null,
  saldo_movel_pessoas  int  not null,       -- quantos ainda têm crédito pró-rata (anda com CURRENT_DATE) nesse dia
  saldo_movel_valor    numeric(14,2) not null,
  sem_data             int  not null,       -- sem combinado de pagamento, ou combinado implausível
  parou_de_pagar       int  not null,       -- parcelando, sem pagamento há mais de 35 dias
  conferir             int  not null,       -- pacote_efetivo não fecha com pago_no_ciclo + falta_pagar
  tirado_em            timestamptz not null default now(),
  primary key (dia, produto, carteira_key)
);

create index if not exists ix_hm_fechamento_dia on cs.hm_fechamento_diario (produto, dia desc);

revoke update, delete on cs.hm_fechamento_diario from disparos_app;
grant  select, insert on cs.hm_fechamento_diario to disparos_app;

comment on table cs.hm_fechamento_diario is
  '0260: snapshot diário do que cs.vw_hm_carteira NÃO consegue reconstruir para trás (a_receber
   depende de CURRENT_DATE; a atribuição de carteira depende da linha do tempo atual). Série
   começa em 16/08/2026 — NENHUM backfill. Append-only (revoke update/delete): um dia fechado
   não muda de valor; refazer a régua é regra_versao nova, nunca UPDATE em cima do que já foi
   medido. Alimentada por cs.fn_hm_fechar_dia via app/api/cron/route.ts.';
comment on column cs.hm_fechamento_diario.regra_versao is
  '0260: qual definição de cs.vw_hm_carteira produziu esta linha. Muda quando a view mudar de
   régua (ex.: uma futura 0261+ que reordene a escada de atribuição) — o dia antigo continua
   contando como foi medido NAQUELE dia, nunca reinterpretado com a régua nova.';
comment on column cs.hm_fechamento_diario.sem_data is
  '0260: pessoas sem data de pagamento combinada (ou combinada com ano implausível). Junto com
   parou_de_pagar, é a base do KPI "Precisam de ação" do painel — a mesma régua de cobrancaDe()
   em lib/services/hm-carteira.ts, replicada em SQL (ver lib/services/hm-painel.ts).';

-- ---------------------------------------------------------------------------------------
-- cs.fn_hm_fechar_dia: fecha UM dia, UMA vez. `on conflict do nothing` cobre o cron rodando
-- várias vezes no mesmo dia (maxDuration/idempotência já são a regra de app/api/cron/route.ts).
-- Refazer um dia é decisão humana (regra_versao nova via migration futura), nunca um UPDATE
-- daqui — a função não tem cláusula de update de propósito.
create or replace function cs.fn_hm_fechar_dia(p_dia date default current_date)
returns int
language plpgsql
as $$
declare
  v_inseridas int;
begin
  insert into cs.hm_fechamento_diario (
    dia, produto, carteira_usuario_id, carteira_nome, regra_versao,
    alunos, quitados, pagando, so_entrada, cancelados,
    recebido_no_ciclo, a_receber, saldo_movel_pessoas, saldo_movel_valor,
    sem_data, parou_de_pagar, conferir
  )
  select
    p_dia,
    v.produto,
    v.carteira_usuario_id,
    v.carteira_nome,
    'vw_hm_carteira@0255b',  -- aplicado depois da 0255b, que corrigiu pagou_entrada_do_programa
    count(*)::int                                                                as alunos,
    count(*) filter (where v.status = 'quitado')::int                            as quitados,
    count(*) filter (where v.status in ('parcelando','pagando_parcial'))::int    as pagando,
    count(*) filter (where v.status = 'so_entrada')::int                         as so_entrada,
    count(*) filter (where v.status in ('cancelado','entrada_estornada'))::int   as cancelados,
    coalesce(sum(v.pago_no_ciclo) filter (where v.status not in ('cancelado','entrada_estornada')), 0) as recebido_no_ciclo,
    coalesce(sum(v.falta_pagar)   filter (where v.status not in ('cancelado','entrada_estornada')), 0) as a_receber,
    count(*) filter (where coalesce(v.credito_ciclo_anterior, 0) > 0)::int       as saldo_movel_pessoas,
    coalesce(sum(v.credito_ciclo_anterior) filter (where coalesce(v.credito_ciclo_anterior, 0) > 0), 0) as saldo_movel_valor,
    -- SEM_DATA e PAROU_DE_PAGAR são mutuamente exclusivos por construção (o CASE resolve
    -- em ordem): a mesma pessoa nunca soma nas duas colunas, e "Precisam de ação" no painel
    -- é literalmente sem_data + parou_de_pagar (lib/services/hm-painel.ts).
    count(*) filter (
      where v.status in ('parcelando','pagando_parcial','so_entrada')
        and coalesce(v.falta_pagar, 0) > 1
        and not (v.restante_situacao = 'parcelando' and v.parcelas_ultima_em is not null
                 and current_date - v.parcelas_ultima_em::date > 35)
        and (
          f.pagamento_previsto_em is null
          or extract(year from f.pagamento_previsto_em) not between 2025 and 2026
          or f.pagamento_previsto_em::date < current_date
        )
    )::int                                                                       as sem_data,
    count(*) filter (
      where v.restante_situacao = 'parcelando' and v.parcelas_ultima_em is not null
        and current_date - v.parcelas_ultima_em::date > 35
    )::int                                                                       as parou_de_pagar,
    count(*) filter (
      where v.pacote_efetivo is not null
        and abs(v.pacote_efetivo - (coalesce(v.pago_no_ciclo, 0) + coalesce(v.falta_pagar, 0))) > 1
    )::int                                                                       as conferir
  from cs.vw_hm_carteira v
  left join cs.vw_hm_financeiro f on f.contato_hm_id = v.contato_hm_id
  where v.pagou_entrada_do_programa
  group by v.produto, v.carteira_usuario_id, v.carteira_nome
  on conflict (dia, produto, carteira_key) do nothing;

  get diagnostics v_inseridas = row_count;
  return v_inseridas;
end;
$$;

comment on function cs.fn_hm_fechar_dia(date) is
  '0260: fecha o dia em cs.hm_fechamento_diario a partir de cs.vw_hm_carteira. on conflict do
   nothing: um dia fecha UMA vez, mesmo chamado várias vezes pelo cron. Chamada por
   app/api/cron/route.ts (CRON_SECRET). Nunca faz UPDATE.';

-- Achado BAIXO do security-pentester (16/08): a função nasceu com EXECUTE aberto para PUBLIC
-- (default do Postgres para `create function`), fora do padrão das vizinhas (0255/0257, que já
-- restringem). Sem isto, qualquer role com acesso ao banco — não só disparos_app — chamaria a
-- função. Aditivo e idempotente: pode rodar de novo sem efeito colateral.
revoke all on function cs.fn_hm_fechar_dia(date) from public;
grant execute on function cs.fn_hm_fechar_dia(date) to disparos_app;

-- ---------------------------------------------------------------------------------------
-- Semeadura: SÓ o dia de hoje (nenhum backfill — ver o cabeçalho). Smoke test embutido:
-- a soma de a_receber recém-inserida precisa bater com uma soma fresca da própria view no
-- mesmo instante (identidade por construção — se divergir, a função tem um bug de group by).
do $$
declare
  v_linhas int;
  v_a_receber_tabela numeric;
  v_a_receber_view   numeric;
begin
  v_linhas := cs.fn_hm_fechar_dia(current_date);

  select coalesce(sum(a_receber), 0) into v_a_receber_tabela
    from cs.hm_fechamento_diario where dia = current_date;

  select coalesce(sum(v.falta_pagar), 0) into v_a_receber_view
    from cs.vw_hm_carteira v
   where v.pagou_entrada_do_programa and v.status not in ('cancelado','entrada_estornada');

  if abs(v_a_receber_tabela - v_a_receber_view) > 0.5 then
    raise exception '0260: a_receber do fechamento (%) nao bate com a soma fresca de vw_hm_carteira (%). Nao aplicar sem investigar.',
      v_a_receber_tabela, v_a_receber_view;
  end if;

  raise notice '0260: fechamento de hoje (%) criado — % linha(s) (produto x carteira), a_receber total R$ %. Conferir contra o topo de /hm/carteira no mesmo minuto.',
    current_date, v_linhas, v_a_receber_tabela;
end $$;

-- ---------------------------------------------------------------------------------------
-- CAMINHO DE VOLTA (não executar — documentado para quem precisar reverter):
--   drop function if exists cs.fn_hm_fechar_dia(date);
--   drop table if exists cs.hm_fechamento_diario;
-- Seguro até o bloco F3 (frontend) ligar alguma tela nela — antes disso, nada lê a tabela
-- além desta própria migration e de lib/services/hm-painel.ts (que devolve null quando vazia).
