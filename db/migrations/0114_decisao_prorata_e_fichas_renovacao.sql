-- =====================================================================
-- 0114_decisao_prorata_e_fichas_renovacao
--
-- Duas decisões comerciais tomadas em 20/07/2026, depois da apuração
-- comercial × financeiro (ver 0112). O SQL aqui só executa o que foi decidido.
--
-- DECISÃO 1 — o crédito pró-rata VALE: o pacote do aluno da base é
--   15.000 − crédito, não 15.000 cheios.
--
--   Os 4 cards de cs.vw_hm_credito_duplo tinham valor_total cravado em 15.000
--   ignorando o crédito, enquanto o pagamento que VIROU esse crédito seguia
--   somado em valor_pago. Zerar o cravado devolve o card à régua: o saldo passa
--   a ser (pacote_regra − pago_no_ciclo), que já desconta o ciclo anterior.
--
--   Efeito: Naiara 0 → 1.138,37 · Pedro 2.700 → 5.363,01 ·
--           Áurea 14.700 → 12.095,69 (cobrava 2.604,31 a MAIS) ·
--           Guilherme 0 → 0 (pagou 13.300 num pacote de 1.438 — devolução
--           de ~11.861 a apurar pelo comercial, fora do escopo desta migration).
--
-- DECISÃO 2 — provisionar ficha de aluno para as 3 renovações órfãs.
--   Pagaram Renovação 2026 (oferta 235hpjy9, produto 3507214) e não existiam
--   em thb_alunos por e-mail, CPF, nome nem comprador_id. Sem ficha, o GPS
--   nunca libera o acesso que eles compraram.
--
-- Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Devolver os 4 cards à régua do pró-rata
-- ---------------------------------------------------------------------
-- NÃO chamar fn_hm_recalcular_financeiro em quem tem lastro (hoje: Guilherme):
-- com valor_total nulo ela recorre a fn_hm_valores_derivados e RE-crava 15.000,
-- desfazendo esta migration. Para os demais (tem_lastro = false) a chamada é
-- segura e serve para ressincronizar valor_pago com o razão.
--
-- Também não mexe em quitado_em: quem de fato cobriu o pacote da régua (o caso
-- do Guilherme, que pagou muito acima) continua quitado — e com razão.
do $$
declare r record;
begin
  for r in select comprador_id, nome from cs.vw_hm_credito_duplo
  loop
    update cs.contatos_hm set valor_total = null, atualizado_em = now()
     where comprador_id = r.comprador_id;

    if not cs.fn_hm_tem_lastro(r.comprador_id) then
      perform cs.fn_hm_recalcular_financeiro(r.comprador_id);
    end if;

    raise notice 'pro-rata aplicado: %', r.nome;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Ficha de aluno para as renovações órfãs
-- ---------------------------------------------------------------------
-- Não usa cs.fn_hm_provisionar_aluno de propósito: aquela função é do fluxo do
-- LEAD NOVO — ancoraria o acesso numa compra 'sinal'/'compra_cheia' que estes
-- não têm (caindo em now()) e os jogaria na turma atual (T39). Eles são alunos
-- de turma ANTERIOR renovando; T39 seria um dado falso.
--
-- turma_id fica NULL (desconhecida, e a coluna aceita — 95 alunos já estão
-- assim). Melhor um campo vazio que o time completa do que uma turma inventada
-- que seis sistemas passam a repetir como verdade.
insert into public.thb_alunos (
  nome, email, telefone, documento, tipo_documento, plano, turma_id, comprador_id,
  data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
  valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
  ultimo_pagamento, fonte, obs_central
)
select cp.nome, cp.email, cp.telefone, cp.documento, cp.tipo_documento, 'aluno',
       null,                                   -- turma desconhecida, ver comentário
       cp.id,
       coalesce(c.data_aprovacao, c.data_compra),
       (coalesce(c.data_aprovacao, c.data_compra) + interval '365 days')::date,
       'Hotmart (THB)', 'Renovação HM + 365 dias', '1 ano',
       c.preco, c.preco, 0, 'quitado', 'Quitado',
       coalesce(c.data_aprovacao, c.data_compra)::date,
       'sip_conciliacao_0114',
       'Ficha criada em 20/07/2026 pela conciliação comercial × financeiro: pagou '
         || 'Renovação 2026 (' || c.hotmart_transaction || ') e não tinha ficha em '
         || 'thb_alunos. Turma de origem desconhecida — confirmar com o comercial.'
  from public.compras c
  join public.compradores cp on cp.id = c.comprador_id
 where c.oferta_codigo = '235hpjy9'
   and c.status in ('APPROVED','COMPLETE','COMPLETED')
   and not exists (select 1 from public.thb_alunos a where a.comprador_id = cp.id)
   and not exists (select 1 from public.thb_alunos a
                    where lower(trim(a.email)) = lower(trim(cp.email)))
   and not exists (select 1 from public.thb_alunos a
                    where cp.documento is not null and a.documento = cp.documento);
