-- 0237_prorata_aurum_planilha_14_08.sql
-- PRÓ-RATA DO AURUM: a planilha do Victor de 14/08 entra no sistema — crédito
-- atualizado de todo mundo + o MOTIVO de cada crédito.
--
-- Fonte: "[ETHB_2026 - SP] CONTROLE DE PAGAMENTO - AURUM (1).xlsx", aba "VICTOR
-- Cálculo do pagamento - A", baixada em 14/08/2026 17:21. 35 pessoas — as mesmas 35
-- da 0194 (casamento 1:1 por e-mail; nenhuma linha entrou, nenhuma saiu).
--
-- ---------------------------------------------------------------------------
-- O QUE MUDOU DA PLANILHA DE 11/08 (0194) PARA ESTA
--
-- 1) OITO PESSOAS GANHARAM CRÉDITO DE R$ 300. Quem pagou só o sinal de R$ 300 do HM
--    (sem HM pleno) passa a ter esse valor abatido do saldo do Aurum:
--
--      Eduardo Fassheber Caram Guimarães ...... eduardo@borgescardoso.adv.br
--      Manuel Lourenço Dallacqua .............. manuel@dgr.com.br
--      Marli de Oliveira Nascimento ........... marli@oliveiranascimentoadv.com
--      Paulete Monteiro Carvalho .............. pauleteagrooeste@hotmail.com
--      Fatima Cilene Chaves Antunes ........... fatimaantunes74@gmail.com
--      Mariane Nascimento Mendes .............. marianenascimento@hotmail.com
--      Vania Claudie Thomaz ................... claudiethomaz@bol.com.br
--      Vezio Azevedo Cunha .................... adv@veziocunha.com.br
--
--    saldo 59.000,00 -> 58.700,00 para os oito. São R$ 2.400 a menos para cobrar no
--    total. Nelson Taborda já estava em 58.700 desde a 0194 — nele só muda o rótulo
--    da situação ("SEM CRÉDITO" -> "TEM CRÉDITO"), o dinheiro é o mesmo.
--
-- 2) A NOTA DO PORQUÊ. Os oito passam a carregar "Só pagou sinal R$300 HM (sem HM
--    pleno)" em `obs` — o campo que o card, a tabela e a ficha já mostram como
--    "Por que este crédito" (app/hm/kanban/page.tsx:1542, app/hm/tabela/page.tsx:1281,
--    app/hm/contatos/[id]/page.tsx:401). Nenhuma tela precisa mudar: o texto vazio é
--    justamente o que `faltaExplicarCredito()` acusa hoje como pendência.
--
--    Vezio troca de motivo: era "Assinatura (mensal, em atraso) — definir valor de
--    crédito manualmente" (a pendência), agora é o sinal de R$ 300 (a resposta).
--
-- 3) Vanda Amorim mantém o nome do titular na obs. A planilha de hoje encurtou o
--    texto para "Sócio — crédito calculado sobre o titular"; a coluna "Acesso
--    calculado sobre" continua dizendo Luis Carlos Fariñas Nantes, e sem o nome a
--    operação não sabe sobre quem a conta foi feita. Mantido o texto da 0194.
--
-- 4) A situação da Iara Célia virou "SEM CRÉDITO" na planilha (era "REVISAR"). ELA
--    NÃO É TOCADA AQUI: é exceção ("não cobrar", gratuidade liberada pelo Marcio e
--    pela Elaine), e planilha não derruba exceção — isso é decisão do Marcio, a mesma
--    regra da 0194. Vale para as três exceções (Iara, Erico, Marcelo Sitonio):
--    `situacao` só é reescrita para quem NÃO está marcado como exceção, senão o
--    rótulo do operador viraria "Não cobrar — SEM CRÉDITO", que não quer dizer nada.
--
-- 5) NÃO IMPORTADA: a coluna nova "Pagou Saldo?", SIM só para Maria José Liberato
--    Montanari. Dar baixa de R$ 59.000 é dinheiro entrando no razão e não é o que foi
--    pedido — precisa de comprovante e da decisão de quem cobra. O bloco de
--    verificação no fim avisa se o saldo dela ainda está de pé no sistema.
--    A outra coluna nova, "Saldo HM Implementação?", é só o de-onde-vem do crédito —
--    já dito em texto na `obs`, não vira campo.
--
-- ---------------------------------------------------------------------------
-- MEDIDO ANTES DE APLICAR (14/08/2026, na planilha)
--   · linhas na aba de cálculo ................................. 35
--   · pessoas com crédito ...................................... 15  (era 7 na 0194)
--   · pessoas cujo crédito muda de VALOR ........................ 8  (0 -> 300)
--   · crédito somado ................................... R$ 64.315,30
--   · quem muda só de rótulo .................................... 2  (Nelson, Iara)
--
-- Idempotente: roda de novo sem efeito. Escreve SÓ em cs.aurum_pagamento_aluno, a
-- tabela-espelho da planilha — não toca cs.contatos_hm, então não passa perto de
-- cs.fn_hm_recalcular_financeiro, que resolve card por comprador_id e reescreveria o
-- card errado de quem tem HM e AURUM ao mesmo tempo (0163/0197). O saldo continua
-- derivado por cs.fn_aurum_saldo (0195/0198): fonte única, board e ficha leem o mesmo
-- número.

-- ---------------------------------------------------------------------------
-- 1) Foto do antes (append-only, prova de quem devia quanto)
-- ---------------------------------------------------------------------------
insert into cs.hm_financeiro_marco (marco, contato_hm_id, pacote_regra, saldo_a_perseguir, situacao)
select 'pre-prorata-aurum-14ago', f.contato_hm_id, f.pacote_regra, f.saldo_a_perseguir, f.situacao
  from cs.vw_hm_financeiro f
  join cs.contatos_hm ch on ch.id = f.contato_hm_id
 where ch.produto = 'AURUM'
on conflict (marco, contato_hm_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) A planilha entra na tabela-espelho
--
-- Casamento por E-MAIL: o documento da planilha vem sem o zero à esquerda em 9 das 35
-- linhas ("1559535911" x "01559535911") — o e-mail não tem essa ambiguidade.
--
-- `credito` vem da coluna "Crédito (pró-rata)". Quando ela está vazia mas a coluna
-- "Saldo a pagar" traz um número MENOR que a base de 59.000 — o caso dos oito de
-- R$ 300 —, o crédito é a diferença: é a coluna de saldo que a operação usa para
-- gerar o link de pagamento. Saldo igual a 59.000 significa "sem crédito" e grava
-- NULL, nunca 0 (0 pintaria a tela como crédito concedido de valor zero).
-- ---------------------------------------------------------------------------
with planilha(email, credito, valor_pago, dias_totais, dias_usados, valor_dia, consumido, saldo_planilha, situacao, obs, pagou_saldo) as (values
  ('contato@marcosadrianomarques.com', null::numeric, null::numeric, null::int, null::int, null::numeric, null::numeric, 59000.00::numeric, 'SEM CRÉDITO', 'Assinatura (mensal, em atraso) — definir valor de crédito manualmente', false),
  ('mariajliberato@hotmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, true),
  ('eduardo@borgescardoso.adv.br', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('patricia@jbleopoldino.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('manuel@dgr.com.br', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('costaborges@aasp.org.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('magdamoraisadv@gmail.com', 13072.68, 13072.68, 365, 29, 35.82, 1038.65, 45927.32, 'TEM CRÉDITO', 'Pagou 13072 no programa de implementação', false),
  ('gilmarafonso@gmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada', false),
  ('marceloxsitonio@gmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Cancelou', false),
  ('andersonsilvaresende@outlook.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('swyano@yahoo.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('escritorioerico@hotmail.com', 6123.29, 15000.00, 365, 216, 41.10, 8876.71, 52876.71, 'REVISAR', 'Já era Aurum, pagou renovação 2026 do Aurum', false),
  ('clscastro.almeida@hotmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('drmarcelocontabil@uol.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('kkosam0512@gmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Assinatura (mensal, em atraso) — definir valor de crédito manualmente', false),
  ('dalesgaldino@yahoo.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('roberto@prradvogados.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada', false),
  ('humbertomarinhoadv@hotmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('balbinavasconcelos@hotmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('marli@oliveiranascimentoadv.com', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('bronze.jessica@hotmail.com', 9082.19, 9082.19, 365, 30, 24.88, 746.48, 49917.81, 'TEM CRÉDITO', 'Pagou 9082,19 no programa de implementação', false),
  ('pauleteagrooeste@hotmail.com', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('fatimaantunes74@gmail.com', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('iaracbcastro.adv@gmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Gratuidade liberada pelo Marcio e Elaine na Imersão de GO', false),
  ('marianenascimento@hotmail.com', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('tabordaoficial@gmail.com', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('renato_habara@uol.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', null, false),
  ('leandroassuncao_adv@hotmail.com', 13072.68, 13072.68, 365, 29, 35.82, 1038.65, 45927.32, 'TEM CRÉDITO', 'Pagou 13072 no programa de implementação', false),
  ('contato@advocaciarodrigomaciel.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada', false),
  ('apkfuri@gmail.com', 13072.68, 13072.68, 365, 29, 35.82, 1038.65, 45927.32, 'TEM CRÉDITO', 'Pagou 13072 no programa de implementação', false),
  -- obs preservada da 0194: a planilha de hoje tirou o nome do titular, e sem ele
  -- ninguém sabe sobre quem o crédito foi calculado.
  ('vandaamorimadv@gmail.com', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Sócio — crédito calculado sobre o titular (Luis Carlos Fariñas Nantes)', false),
  ('claudiethomaz@bol.com.br', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('adv@veziocunha.com.br', 300.00, null, null, null, null, null, 58700.00, 'TEM CRÉDITO', 'Só pagou sinal R$300 HM (sem HM pleno)', false),
  ('chriselima@yahoo.com.br', null, null, null, null, null, null, 59000.00, 'SEM CRÉDITO', 'Ex-aluno/ex-HT/não localizado — sem compra registrada', false),
  ('soniambgentil@gmail.com', 7191.78, 7191.78, 365, 31, 19.70, 610.81, 51808.22, 'TEM CRÉDITO', 'Pagou 7191,78 no programa de implementação', false)
), base as (
  select (select valor from cs.aurum_parametros where chave = 'pacote_cheio')
       - (select valor from cs.aurum_parametros where chave = 'entrada') as base_saldo
), alvo as (
  select p.*,
         coalesce(
           p.credito,
           case when p.saldo_planilha is not null and b.base_saldo - p.saldo_planilha <> 0
                then round(b.base_saldo - p.saldo_planilha, 2) end
         ) as credito_final
    from planilha p cross join base b
)
update cs.aurum_pagamento_aluno a
   set credito       = alvo.credito_final,
       valor_pago    = alvo.valor_pago,
       dias_totais   = alvo.dias_totais,
       dias_usados   = alvo.dias_usados,
       valor_dia     = alvo.valor_dia,
       consumido     = alvo.consumido,
       -- exceção manda: a planilha não reclassifica quem o Marcio marcou como "não cobrar"
       situacao      = case when a.excecao then a.situacao else alvo.situacao end,
       obs           = coalesce(alvo.obs, a.obs),
       atualizado_em = now()
  from alvo
 where lower(trim(a.email)) = alvo.email
   and (a.credito     is distinct from alvo.credito_final
     or a.valor_pago  is distinct from alvo.valor_pago
     or a.dias_usados is distinct from alvo.dias_usados
     or a.consumido   is distinct from alvo.consumido
     or a.obs         is distinct from coalesce(alvo.obs, a.obs)
     or (not a.excecao and a.situacao is distinct from alvo.situacao));

-- ---------------------------------------------------------------------------
-- 3) Verificação — falha alto se a planilha não pousou como devia
--
-- A trava que faltava na 0194: se o casamento por e-mail quebrar (alguém troca o
-- e-mail no cadastro), o UPDATE não dá erro nenhum — ele só não acha a linha, e o
-- crédito fica desatualizado em silêncio, que é dinheiro cobrado a mais.
-- ---------------------------------------------------------------------------
do $$
declare
  v_linhas    int;
  v_com300    int;
  v_credito   numeric;
  v_pagou     text;
  v_divergem  text;
begin
  select count(*) into v_linhas from cs.aurum_pagamento_aluno;
  if v_linhas <> 35 then
    raise exception '0237: esperava 35 linhas em cs.aurum_pagamento_aluno, achei %. A planilha de 14/08 tem 35 — conferir quem entrou/saiu antes de seguir.', v_linhas;
  end if;

  -- os nove de R$ 300 (os oito novos + Nelson, que já estava)
  select count(*) into v_com300
    from cs.aurum_pagamento_aluno
   where lower(trim(email)) in (
     'eduardo@borgescardoso.adv.br','manuel@dgr.com.br','marli@oliveiranascimentoadv.com',
     'pauleteagrooeste@hotmail.com','fatimaantunes74@gmail.com','marianenascimento@hotmail.com',
     'claudiethomaz@bol.com.br','adv@veziocunha.com.br','tabordaoficial@gmail.com')
     and credito = 300.00
     and obs = 'Só pagou sinal R$300 HM (sem HM pleno)';
  if v_com300 <> 9 then
    raise exception '0237: esperava 9 pessoas com crédito de 300 e o motivo escrito, achei %. Casamento por e-mail falhou — NÃO cobrar 59.000 de quem tem crédito.', v_com300;
  end if;

  select coalesce(sum(credito), 0) into v_credito from cs.aurum_pagamento_aluno;
  if round(v_credito, 2) <> 64315.30 then
    raise exception '0237: crédito somado deu % — a planilha de 14/08 fecha em 64.315,30.', round(v_credito, 2);
  end if;

  -- ninguém com crédito pode ficar sem o porquê: é esse texto que a tela cobra
  select string_agg(nome, ', ') into v_divergem
    from cs.aurum_pagamento_aluno
   where coalesce(credito, 0) > 0 and coalesce(nullif(trim(obs), ''), nullif(trim(excecao_motivo), '')) is null;
  if v_divergem is not null then
    raise exception '0237: crédito sem explicação registrada para: %', v_divergem;
  end if;

  -- AVISO (não trava): a planilha diz que já pagou o saldo, e o sistema ainda cobra
  select string_agg(a.nome || ' (saldo ' || to_char(cs.fn_aurum_saldo(a.comprador_id), 'FM999G999D00') || ')', '; ')
    into v_pagou
    from cs.aurum_pagamento_aluno a
   where lower(trim(a.email)) in ('mariajliberato@hotmail.com')
     and coalesce(cs.fn_aurum_saldo(a.comprador_id), 0) > 0;
  if v_pagou is not null then
    raise notice '0237: a planilha marca "Pagou Saldo? SIM" e o sistema ainda cobra: %. Baixa de pagamento NÃO foi feita aqui — precisa de comprovante e decisão de quem cobra.', v_pagou;
  end if;

  -- AVISO: exceções cuja situação na planilha mudou e foi deliberadamente ignorada
  select string_agg(nome || ' (' || situacao || ')', '; ') into v_divergem
    from cs.aurum_pagamento_aluno where excecao;
  raise notice '0237: exceções preservadas (planilha não derruba "não cobrar"): %', coalesce(v_divergem, 'nenhuma');

  raise notice '0237: planilha de 14/08 aplicada — 15 pessoas com crédito, R$ % somados, 8 saldos de 59.000 para 58.700.', round(v_credito, 2);
end $$;
