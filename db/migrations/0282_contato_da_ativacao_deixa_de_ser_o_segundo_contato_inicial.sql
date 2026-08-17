-- =====================================================================
-- 0282_contato_da_ativacao_deixa_de_ser_o_segundo_contato_inicial
--
-- O menu de estágios do HM tem DOIS estágios chamados "Contato Inicial":
--   hm_comprou            (ordem 10, aba comercial) — o card chegou, ninguém
--                          falou com o comprador ainda.
--   hm_ativacao_contato   (ordem 80, aba ativação)  — o card já pagou e já
--                          foi liberado; agora é a ATIVAÇÃO abordando pela
--                          primeira vez, depois do Acesso Liberado.
--
-- Mesmo nome, estágios completamente diferentes (produto já vendido vs.
-- lead ainda não abordado) — quem olha o seletor da ficha ou o filtro do
-- board não tem como distinguir um do outro só pelo rótulo.
--
-- Esta migration renomeia SÓ o da ativação. `hm_comprou` CONTINUA "Contato
-- Inicial" — é o nome certo para o comercial (0048: "'hm_comprou' passa a
-- se chamar Contato Inicial (...) ela não é 'quem comprou', é 'quem o
-- comercial ainda precisa abordar'"), e mexer nele reabriria uma decisão já
-- tomada sem necessidade.
--
-- A CHAVE não muda (`hm_ativacao_contato`) — é referenciada pelo código
-- (app/api/hm/contato/[id]/route.ts, cs.fn_hm_etapa_pos_pagamento e outras
-- funções do módulo) e por todo o histórico de cs.interacoes. Só o rótulo
-- exibido muda.
--
-- Aditiva e idempotente (UPDATE por chave, sem efeito colateral em nada
-- além do nome do estágio).
-- =====================================================================

update cs.estagios
   set nome = 'Contato da Ativação'
 where evento = 'HM' and chave = 'hm_ativacao_contato';

comment on column cs.estagios.nome is
  'Rótulo exibido no board/seletor. 0282: hm_ativacao_contato virou "Contato da Ativação" para não colidir, no menu, com "Contato Inicial" (hm_comprou, aba comercial) — mesmo nome, dois estágios distintos. hm_comprou continua "Contato Inicial" (decisão da 0048, mantida).';
