-- 0158_aurum_ethb_sp_saldo.sql
-- Traz para o banco o cálculo de pagamento dos alunos do AURUM ETHB SP, que hoje só
-- existe na planilha do Victor ("[ETHB_2026 - SP] CONTROLE DE PAGAMENTO - AURUM").
-- Sem isso o operador da ativação não tem como saber quanto cada aluno deve — a base
-- THB não guarda crédito pró-rata nem saldo do Aurum.
--
-- REGRA DO PACOTE (Marcio, 10/08/2026):
--   pacote Aurum cheio = R$ 60.000 · entrada (taxa de inscrição `qm4lu7py`) = R$ 1.000
--   => base do saldo   = R$ 59.000, e é sobre ela que o crédito pró-rata é abatido.
-- Confere com a planilha: 46.965,97 + 12.034,03 = 59.000 (caso Magda/Leandro/Ana Paula).
--
-- O CRÉDITO NÃO É RECALCULADO AQUI. O pró-rata é conta comercial do Victor (dias
-- usados × valor/dia sobre a última compra que deu acesso) e depende de dado que não
-- vive no banco. Ingerimos o crédito COMO VEIO e derivamos só o saldo, que é
-- aritmética pura — assim a planilha continua sendo a fonte da regra e o banco vira a
-- fonte do NÚMERO que o operador vê. Ver [[hm-credito-prorata]].
--
-- ⚠️ Não escreve em cs.contatos_hm.valor_total/valor_pago: aqueles campos são do
-- funil HM (pacote de 15k) e têm dono — `cs.fn_hm_valores_derivados` e o financeiro.
-- Misturar os dois faria o card do HM mentir. Esta tabela é um OVERLAY do Aurum.
-- Idempotente.

create table if not exists cs.aurum_pagamento_aluno (
  documento        text primary key,
  nome             text not null,
  email            text,
  telefone         text,
  origem_instrucao text,                 -- THB · AURUM · Ex aluno · THB - SÓCIO...
  acesso_sobre     text,                 -- de quem é o acesso (sócio usa o titular)
  ultima_oferta    text,                 -- compra que deu o acesso usado no pró-rata
  ultima_compra_em date,
  valor_pago       numeric(12,2),        -- o que ele pagou na compra que gera crédito
  dias_totais      integer,
  dias_usados      integer,
  valor_dia        numeric(12,2),
  consumido        numeric(12,2),
  credito          numeric(12,2),        -- pró-rata calculado pelo Victor (não recalcular)
  situacao         text not null,        -- TEM CRÉDITO · SEM CRÉDITO · REVISAR
  excecao          boolean not null default false,  -- não cobrar (gratuidade/cancelado/revisar)
  excecao_motivo   text,
  obs              text,
  comprador_id     uuid references public.compradores(id),
  importado_em     timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

comment on table cs.aurum_pagamento_aluno is
  'Cálculo de pagamento do Aurum ETHB SP (planilha do Victor). Pacote 60k - entrada 1k = 59k de base; crédito pró-rata vem pronto da planilha e NÃO é recalculado aqui.';
comment on column cs.aurum_pagamento_aluno.excecao is
  'true = não cobrar: gratuidade, cancelamento ou caso em revisão. O saldo fica NULL na view.';

create index if not exists ix_aurum_pag_comprador on cs.aurum_pagamento_aluno (comprador_id);

-- Parâmetros do pacote em um lugar só, para a próxima turma não precisar caçar número
-- hardcoded na view (foi assim que o dashboard do HT quebrou em silêncio).
create table if not exists cs.aurum_parametros (
  chave text primary key,
  valor numeric(12,2) not null,
  nota  text
);
insert into cs.aurum_parametros (chave, valor, nota) values
  ('pacote_cheio', 60000.00, 'Aurum ETHB SP 2026 — valor cheio do programa'),
  ('entrada',       1000.00, 'Taxa de inscrição (oferta qm4lu7py), já paga na Hotmart')
on conflict (chave) do update set valor = excluded.valor, nota = excluded.nota;

-- ---------------------------------------------------------------------------
-- A view que o operador lê. O saldo é DERIVADO — nunca gravado — para não
-- fossilizar erro (mesma lição do crédito duplo do HM, [[hm-credito-duplo-quarentena]]).
--
--   saldo = (pacote_cheio - entrada) - credito
--
-- Exceção (gratuidade/cancelado/revisar) devolve saldo NULL: melhor o operador ver
-- "a definir" do que cobrar R$59.000 de quem ganhou gratuidade do Marcio.
-- ---------------------------------------------------------------------------
create or replace view cs.vw_aurum_saldo as
with p as (
  select
    (select valor from cs.aurum_parametros where chave='pacote_cheio') as pacote,
    (select valor from cs.aurum_parametros where chave='entrada')      as entrada
)
select
  a.documento, a.nome, a.email, a.telefone, a.comprador_id,
  a.origem_instrucao, a.ultima_oferta, a.ultima_compra_em,
  a.valor_pago, a.credito, a.situacao, a.excecao, a.excecao_motivo, a.obs,
  p.pacote                                   as pacote_cheio,
  p.entrada                                  as entrada_paga,
  (p.pacote - p.entrada)                     as base_saldo,
  case when a.excecao then null
       else round((p.pacote - p.entrada) - coalesce(a.credito, 0), 2)
  end                                        as saldo_a_pagar,
  -- Rótulo pronto para a tela: o operador não deve precisar interpretar NULL.
  case
    when a.excecao                     then 'Não cobrar — ' || coalesce(a.excecao_motivo, a.situacao)
    when coalesce(a.credito,0) > 0     then 'Deve com crédito abatido'
    else                                    'Deve o pacote cheio (sem crédito)'
  end                                        as rotulo_operador
from cs.aurum_pagamento_aluno a cross join p;

grant select on cs.aurum_pagamento_aluno to disparos_app;
grant select on cs.vw_aurum_saldo        to disparos_app;
grant select on cs.aurum_parametros      to disparos_app;
