-- 0313_o_funil_do_acelera_e_de_ligacao
--
-- ── O pedido (Victor, 26/08) ────────────────────────────────────────────────
-- "Tudo que tem a ver com reunião a gente não precisa. Precisa ter: lead,
--  aguardando o contato, não atendeu, ligação, proposta, demonstrou o interesse,
--  sem interesse, vendido. Só pro Acelera — não quero que mude em nenhum outro
--  portal."
--
-- O funil de estreia foi copiado do comercial do HM, que é uma venda de ticket
-- alto com reunião marcada. O Acelera é venda por TELEFONE: o que acontece de
-- verdade é ligar, não pegar, ligar de novo, mandar proposta. "Reunião Agendada"
-- e "Reunião Finalizada" nunca seriam usadas e só ocupariam espaço no board.
--
-- ⚠️ ESCOPO: os estágios são POR EVENTO (cs.estagios.evento). Tudo aqui filtra
-- evento = 'ACELERA'. HT, Seminário, HM, Aurum e ETHB não são tocados — conferido
-- antes de rodar: nenhum contato de outro evento usa estes estágios.

-- 1) Saem as etapas de reunião e as que viraram outra coisa -----------------
-- Desativadas, não apagadas: `ativo = false` some do board e preserva o
-- histórico de quem já passou por elas (aqui, ninguém — os 299 estão todos em
-- Lead, conferido antes). Apagar quebraria a FK de cs.contatos.estagio_id.
update cs.estagios set ativo = false
 where evento = 'ACELERA'
   and chave in ('acel_contato_inicial','acel_aguardando_retorno',
                 'acel_reuniao_agendada','acel_reuniao_finalizada');

-- 2) As que ficam, na ordem que o Victor pediu ------------------------------
-- 'acel_vendido' MANTÉM a chave: o trigger fn_acelera_comprou_vai_para_vendido
-- (0309) procura por ela para mover o card quando a compra é marcada. Renomear
-- a chave aqui deixaria o gatilho apontando para o vazio, em silêncio.
update cs.estagios set nome = 'Proposta',        ordem = 50 where evento='ACELERA' and chave='acel_proposta_enviada';
update cs.estagios set nome = 'Sem interesse',   ordem = 70 where evento='ACELERA' and chave='acel_sem_interesse';
update cs.estagios set nome = 'Vendido',         ordem = 80 where evento='ACELERA' and chave='acel_vendido';
update cs.estagios set ordem = 10                where evento='ACELERA' and chave='acel_lead';

-- 3) As novas ---------------------------------------------------------------
-- Cores com leitura: âmbar = esperando, rosa = não conseguiu falar,
-- azul = em contato, índigo = proposta na mesa, verde = interesse/ganho.
insert into cs.estagios (evento, chave, nome, aba, ordem, cor, is_inicial, is_final, ativo)
select * from (values
  ('ACELERA','acel_aguardando_contato',   'Aguardando contato',   'comercial', 20, '#f59e0b', false, false, true),
  ('ACELERA','acel_nao_atendeu',          'Não atendeu',          'comercial', 30, '#f43f5e', false, false, true),
  ('ACELERA','acel_ligacao',              'Ligação',              'comercial', 40, '#3b82f6', false, false, true),
  ('ACELERA','acel_demonstrou_interesse', 'Demonstrou interesse', 'comercial', 60, '#10b981', false, false, true)
) as v(evento, chave, nome, aba, ordem, cor, is_inicial, is_final, ativo)
where not exists (select 1 from cs.estagios e where e.chave = v.chave);
