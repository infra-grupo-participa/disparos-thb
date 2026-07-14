-- =====================================================================
-- 0078_hm_visao_financeira
--
-- A REGRA DO NEGÓCIO, ESCRITA UMA VEZ SÓ E CONFERÍVEL:
--
--   Lead novo (fora da base):   pacote = 15.000 · sinal 300 · saldo = 14.700
--   Aluno da base:              pacote = 15.000 − crédito · saldo = 14.700 − crédito
--                               crédito = o que ele pagou e ainda NÃO usou (pró-rata)
--
-- Aluno da base com acesso vencido tem crédito ZERO — paga o saldo cheio, como um
-- lead novo. Não é exceção: é a regra levada até o fim (não sobrou nada por usar).
--
-- Esta view NÃO ESCREVE NADA. Ela põe lado a lado, para cada card:
--   o que a regra manda cobrar · o que está cravado no card · o que a Hotmart pagou
-- e nomeia a diferença. Onde a régua e o card discordam, alguém precisa olhar —
-- e cada real de diferença é dinheiro entrando ou saindo do bolso.
--
-- Por que view e não coluna: o crédito pró-rata ENCOLHE A CADA DIA (o aluno vai
-- consumindo o que pagou). Um número gravado ontem mente hoje. O valor só congela
-- quando a oferta é enviada — e aí ele vira `valor_total` no card, cravado.
--
-- Aditiva e idempotente.
-- =====================================================================

create or replace view cs.vw_hm_financeiro as
with base as (
  select
    ch.id            as contato_hm_id,
    ch.comprador_id,
    cp.nome,
    cp.email,
    ch.turma,
    ch.turma_origem,
    ch.estagio_id,
    ch.valor_total,                              -- o pacote cravado (quando existe)
    coalesce(ch.valor_pago, 0)   as pago,        -- soma da razão (0075)
    ch.quitado_em,
    ch.oferta_saldo_codigo,
    ch.link_saldo_enviado_em,
    ch.cancelamento_efetivado_em,
    ch.acesso_preexistente,
    ch.credito_valor_pago,
    ch.credito_compra_em,
    case
      when 'Aluno THB'   = any(ch.tags) then 'aluno_base'
      when 'Aluno Aurum' = any(ch.tags) then 'aluno_base'
      when 'Lead novo'   = any(ch.tags) then 'lead_novo'
      else 'nao_classificado'
    end as publico,
    -- Crédito de hoje. Sem insumos (valor pago + data da compra anterior), a função
    -- não devolve linha: o crédito é DESCONHECIDO, e desconhecido não é zero.
    (select pr.credito from cs.fn_hm_prorata(ch.comprador_id) pr) as credito_hoje
  from cs.contatos_hm ch
  join public.compradores cp on cp.id = ch.comprador_id
),
regra as (
  select b.*,
    -- Aluno da base SEM insumo: não dá para afirmar o saldo. Fica nulo, e a lente
    -- "incalculável" cobra o preenchimento. Lead novo não tem crédito por definição.
    case
      when b.publico = 'lead_novo' then 0::numeric
      else b.credito_hoje
    end as credito,
    case
      when b.publico = 'lead_novo' then 15000::numeric
      when b.credito_hoje is not null then round(15000 - b.credito_hoje, 2)
    end as pacote_regra,
    case
      when b.publico = 'lead_novo' then 14700::numeric
      when b.credito_hoje is not null then round(14700 - b.credito_hoje, 2)
    end as saldo_regra
  from base b
)
select
  r.contato_hm_id, r.comprador_id, r.nome, r.email, r.turma, r.turma_origem,
  r.estagio_id, r.publico,
  r.credito_valor_pago, r.credito_compra_em,
  r.credito,
  r.pacote_regra,                                       -- o que a regra manda
  r.saldo_regra,                                        -- o saldo pela regra, hoje
  r.valor_total    as pacote_cravado,                   -- o que o card afirma
  r.pago,
  case when r.valor_total is not null
       then greatest(r.valor_total - r.pago, 0) end as saldo_cravado,
  -- O saldo que a operação deve perseguir: o cravado manda (foi negociado);
  -- sem ele, vale a régua.
  coalesce(
    case when r.valor_total is not null then greatest(r.valor_total - r.pago, 0) end,
    case when r.pacote_regra is not null then greatest(r.pacote_regra - r.pago, 0) end
  ) as saldo_a_perseguir,
  -- Diferença entre o que está cravado e o que a regra manda. Positivo = está sendo
  -- cobrado A MAIS. Negativo = está sendo cobrado A MENOS (dinheiro na mesa).
  case when r.valor_total is not null and r.pacote_regra is not null
       then round(r.valor_total - r.pacote_regra, 2) end as divergencia_regra,
  r.quitado_em is not null                       as quitado,
  r.cancelamento_efetivado_em is not null        as cancelado,
  r.oferta_saldo_codigo,
  r.link_saldo_enviado_em is not null            as oferta_enviada,
  -- Onde cada card está, financeiramente
  case
    when r.cancelamento_efetivado_em is not null                     then 'cancelado'
    when r.quitado_em is not null                                    then 'quitado'
    when exists (select 1 from cs.hm_pagamentos p
                  where p.comprador_id = r.comprador_id
                    and p.categoria = 'mensalidade')                 then 'mensalidade_em_curso'
    when r.publico = 'aluno_base' and r.credito_hoje is null         then 'incalculavel'
    when r.link_saldo_enviado_em is not null                         then 'oferta_enviada'
    else                                                                  'saldo_parado'
  end as situacao
from regra r;

grant select on cs.vw_hm_financeiro to disparos_app;

-- O painel: uma linha por situação, com o dinheiro de cada uma.
create or replace view cs.vw_hm_financeiro_painel as
select
  situacao,
  count(*)                                             as cards,
  round(sum(pago), 2)                                  as ja_recebido,
  round(sum(coalesce(saldo_a_perseguir, 0)), 2)        as a_receber,
  round(sum(coalesce(credito, 0)), 2)                  as credito_concedido
from cs.vw_hm_financeiro
where not cancelado
group by situacao
order by a_receber desc;

grant select on cs.vw_hm_financeiro_painel to disparos_app;
