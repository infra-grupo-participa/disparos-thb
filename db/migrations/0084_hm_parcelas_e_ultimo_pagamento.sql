-- =====================================================================
-- 0084_hm_parcelas_e_ultimo_pagamento
--
-- "PAGOU 3 DE 12" E "PAGOU AGORA".
--
-- A razão (0075) já registra cada mensalidade, mas a tela não sabia contar: quem
-- paga parcelado aparecia igual a quem não paga nada há dois meses. Duas perguntas
-- que a operação faz todo dia e o sistema não respondia:
--   · quanto dessa dívida já entrou? (3 de 12, R$ 3.449,97 de R$ 13.072,68)
--   · alguém pagou desde ontem?      (é o que faz o card subir para o topo)
--
-- `parcelas_contratadas` vem de compras.parcelas do parcelado Hotmart — é o que a
-- pessoa assinou. `parcelas_pagas` é a contagem no razão: fato, não promessa. Um
-- não confere o outro por acaso; a diferença ENTRE ELES é a inadimplência.
--
-- Colunas novas vão para o FIM: create-or-replace de view não deixa inserir no meio.
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
    (select coalesce(sum(p.valor), 0)
       from cs.hm_pagamentos p
      where p.comprador_id = ch.comprador_id
        and (ch.credito_compra_em is null or p.pago_em::date > ch.credito_compra_em)
    ) as pago_no_ciclo,
    -- Quando caiu o último real desta pessoa. É o que ordena a tela: quem pagou
    -- agora sobe para o topo.
    (select max(p.pago_em) from cs.hm_pagamentos p
      where p.comprador_id = ch.comprador_id) as ultimo_pagamento_em,
    -- Parcelas PAGAS: contagem no razão. Fato.
    (select count(*) from cs.hm_pagamentos p
      where p.comprador_id = ch.comprador_id and p.categoria = 'mensalidade')::int
      as parcelas_pagas,
    -- Parcelas CONTRATADAS: o que a pessoa assinou no parcelado da Hotmart.
    (select max(c.parcelas) from public.compras c
      where c.comprador_id = ch.comprador_id
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
        and c.metodo_pagamento = 'HOTMART_INSTALLMENTS')::int
      as parcelas_contratadas,
    (select max(p.valor) from cs.hm_pagamentos p
      where p.comprador_id = ch.comprador_id and p.categoria = 'mensalidade')
      as valor_parcela
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
  r.pago,
  case when r.valor_total is not null then greatest(r.valor_total - r.pago, 0) end as saldo_cravado,
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
  r.pago_no_ciclo,
  -- ---- novas (0084) ----
  r.ultimo_pagamento_em,
  r.parcelas_pagas,
  r.parcelas_contratadas,
  r.valor_parcela,
  -- Quanto do pacote já entrou, em %. Sem pacote definido não se afirma progresso.
  case when coalesce(r.valor_total, r.pacote_regra) > 0
       then round(100 * r.pago / coalesce(r.valor_total, r.pacote_regra), 1) end as pago_pct
from regra r;

grant select on cs.vw_hm_financeiro to disparos_app;
