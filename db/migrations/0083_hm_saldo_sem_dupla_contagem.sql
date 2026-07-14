-- =====================================================================
-- 0083_hm_saldo_sem_dupla_contagem
--
-- O MESMO REAL NÃO PODE SER CONTADO DUAS VEZES.
--
-- A view 0078 calculava:  saldo = (15.000 − crédito) − tudo o que a pessoa pagou.
-- Mas o CRÉDITO É a compra antiga ainda não consumida. Quando essa compra também
-- está na razão de pagamentos, ela abate o saldo uma segunda vez — e uma dívida
-- real vira zero.
--
-- A Naiara é o caso: comprou o HM cheio (R$ 15.000) em 15/06/2026 e pagou o sinal
-- do Programa em 07/07. O crédito dela é quase integral (comprou há um mês), então
-- o pacote cai para ~R$ 1.192 — e o saldo devia ser ~R$ 892. A view mostrava R$ 0,
-- porque descontava OUTRA VEZ os R$ 15.000 que já estavam embutidos no crédito.
-- Zero é exatamente o que ela NÃO deve.
--
-- O que abate o pacote é o dinheiro do CICLO ATUAL do HM — o que entrou DEPOIS da
-- compra que gerou o crédito. Sem crédito (lead novo), tudo é do ciclo atual.
--
-- Aditiva e idempotente.
-- =====================================================================

create or replace view cs.vw_hm_financeiro as
with base as (
  select
    ch.id as contato_hm_id, ch.comprador_id, cp.nome, cp.email,
    ch.turma, ch.turma_origem, ch.estagio_id,
    ch.valor_total, coalesce(ch.valor_pago, 0) as pago, ch.quitado_em,
    ch.oferta_saldo_codigo, ch.link_saldo_enviado_em, ch.cancelamento_efetivado_em,
    ch.acesso_preexistente, ch.credito_valor_pago, ch.credito_compra_em,
    case
      when 'Aluno THB'   = any(ch.tags) then 'aluno_base'
      when 'Aluno Aurum' = any(ch.tags) then 'aluno_base'
      when 'Lead novo'   = any(ch.tags) then 'lead_novo'
      else 'nao_classificado'
    end as publico,
    (select pr.credito from cs.fn_hm_prorata(ch.comprador_id) pr) as credito_hoje,
    -- Só o dinheiro do ciclo atual do HM abate o pacote. O que foi pago ATÉ a
    -- compra que gerou o crédito já está dentro do crédito — contar de novo seria
    -- dar quitação com o mesmo dinheiro duas vezes.
    (select coalesce(sum(p.valor), 0)
       from cs.hm_pagamentos p
      where p.comprador_id = ch.comprador_id
        and (ch.credito_compra_em is null
             or p.pago_em::date > ch.credito_compra_em)
    ) as pago_no_ciclo
  from cs.contatos_hm ch
  join public.compradores cp on cp.id = ch.comprador_id
),
regra as (
  select b.*,
    case when b.publico = 'lead_novo' then 0::numeric else b.credito_hoje end as credito,
    case when b.publico = 'lead_novo' then 15000::numeric
         when b.credito_hoje is not null then round(15000 - b.credito_hoje, 2) end as pacote_regra,
    case when b.publico = 'lead_novo' then 14700::numeric
         when b.credito_hoje is not null then round(14700 - b.credito_hoje, 2) end as saldo_regra
  from base b
)
select
  r.contato_hm_id, r.comprador_id, r.nome, r.email, r.turma, r.turma_origem,
  r.estagio_id, r.publico, r.credito_valor_pago, r.credito_compra_em,
  r.credito, r.pacote_regra, r.saldo_regra,
  r.valor_total as pacote_cravado,
  r.pago,                    -- tudo o que a razão conhece (inclui a compra antiga)
  case when r.valor_total is not null then greatest(r.valor_total - r.pago, 0) end as saldo_cravado,
  -- O saldo a perseguir. Com pacote cravado, ele manda (foi negociado, e o
  -- valor_pago do card já é a razão inteira). Sem pacote, vale a régua — e aí só o
  -- dinheiro do ciclo atual abate, senão o crédito conta duas vezes.
  coalesce(
    case when r.valor_total is not null then greatest(r.valor_total - r.pago, 0) end,
    case when r.pacote_regra is not null then greatest(r.pacote_regra - r.pago_no_ciclo, 0) end
  ) as saldo_a_perseguir,
  case when r.valor_total is not null and r.pacote_regra is not null
       then round(r.valor_total - r.pacote_regra, 2) end as divergencia_regra,
  r.quitado_em is not null                as quitado,
  r.cancelamento_efetivado_em is not null as cancelado,
  r.oferta_saldo_codigo,
  r.link_saldo_enviado_em is not null     as oferta_enviada,
  case
    when r.cancelamento_efetivado_em is not null then 'cancelado'
    when r.quitado_em is not null                then 'quitado'
    when exists (select 1 from cs.hm_pagamentos p
                  where p.comprador_id = r.comprador_id and p.categoria = 'mensalidade')
                                                 then 'mensalidade_em_curso'
    when r.publico = 'aluno_base' and r.credito_hoje is null then 'incalculavel'
    when r.link_saldo_enviado_em is not null     then 'oferta_enviada'
    else 'saldo_parado'
  end as situacao,
  -- No FIM de propósito: create-or-replace de view não deixa inserir coluna no meio
  -- (quem consome por posição quebraria).
  r.pago_no_ciclo            -- só o que entrou no ciclo atual do HM
from regra r;

grant select on cs.vw_hm_financeiro to disparos_app;
