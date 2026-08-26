-- 0314_o_funil_do_acelera_enxuto
--
-- ── O pedido (Victor, 26/08) ────────────────────────────────────────────────
-- "Proposta não faz sentido ter. Aguardando o contato também não. É muito
--  simples: lead, não atendeu, ligação, demonstrou interesse, sem interesse,
--  vendido. Só isso."
--
-- Saem duas etapas que a 0313 tinha criado. "Aguardando contato" descrevia o
-- MESMO estado que "Lead" (lead que entrou e ninguém ligou ainda), e etapa que
-- não muda o que o vendedor faz só divide a fila sem informar nada. "Proposta"
-- pressupunha um material formal entre a ligação e o fechamento, que não existe
-- nessa venda.
--
-- Desativadas, não apagadas — mesmo motivo da 0313: preserva histórico e não
-- quebra a FK de cs.contatos.estagio_id. Nenhum card estava nelas.
--
-- ⚠️ SÓ O ACELERA: tudo filtra evento = 'ACELERA'.

update cs.estagios set ativo = false
 where evento = 'ACELERA' and chave in ('acel_aguardando_contato','acel_proposta_enviada');

-- Ordem final, como o Victor ditou.
update cs.estagios set ordem = 10 where evento='ACELERA' and chave='acel_lead';
update cs.estagios set ordem = 20 where evento='ACELERA' and chave='acel_nao_atendeu';
update cs.estagios set ordem = 30 where evento='ACELERA' and chave='acel_ligacao';
update cs.estagios set ordem = 40 where evento='ACELERA' and chave='acel_demonstrou_interesse';
update cs.estagios set ordem = 50 where evento='ACELERA' and chave='acel_sem_interesse';
update cs.estagios set ordem = 60 where evento='ACELERA' and chave='acel_vendido';
