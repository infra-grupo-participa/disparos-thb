-- =====================================================================
-- 0108_estagio_pagamento_parcelado
--
-- A coluna "Pagamento Parcelado" — entre "Reunião Finalizada" (30) e "Pagamento
-- Realizado" (40), na esteira Comercial. Quem pagou ≥1 parcela e ainda não quitou
-- (situacao = mensalidade_em_curso) já ENTRA na Ativação (recebe acesso), e o
-- Comercial passa a vê-lo aqui — em vez de "Pagamento Realizado" — para deixar
-- claro que a parcela está em curso.
--
-- A fronteira: a Ativação enxerga só "parcela em dia / atrasada" (pela data
-- prometida); a cobrança da parcela é do FINANCEIRO (grupoparticipa.app.br).
--
-- Esta migration só CRIA o estágio. Quem decide que um card aparece aqui é o
-- espelho no board (situacao mensalidade_em_curso) — nenhum card é movido à força.
-- Idempotente.
-- =====================================================================

insert into cs.estagios (chave, nome, aba, ordem, cor, evento, ativo)
select 'hm_pagamento_parcelado', 'Pagamento Parcelado', 'comercial', 35, '#6366f1', 'HM', true
 where not exists (select 1 from cs.estagios where evento = 'HM' and chave = 'hm_pagamento_parcelado');
