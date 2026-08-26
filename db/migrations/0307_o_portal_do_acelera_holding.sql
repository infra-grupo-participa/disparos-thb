-- 0307_o_portal_do_acelera_holding
--
-- ── O pedido (Victor, 26/08) ─────────────────────────────────────────────────
-- "A gente tem vários canais lá: HT, HM, Aurum. Quero criar mais um pro Acelera
--  Holding, que é o que a gente vai vender hoje. Não vai ter ativação, é só o
--  comercial, então só preciso do Kanban funcionando. Ele é um produto diferente
--  do HM — talvez tenha um status de Kanban diferente."
--
-- ── Por que EVENTO novo, e não produto dentro do HM ─────────────────────────
-- AURUM e ETHB são produtos DENTRO do evento HM: compartilham a mesma esteira,
-- os mesmos estágios e a mesma carteira. O Acelera Holding não compartilha nada
-- disso — a base vem do CNHF, o funil é de venda direta e a operação é outro
-- time. Pendurá-lo no HM herdaria os 11 estágios do comercial do HM (incluindo
-- Boleto Gerado, Sinal Pago, Reembolsado) e faria os cards aparecerem para quem
-- tem função no HM pela esteira compartilhada (lib/papeis.ts) — vazamento de
-- carteira entre produtos que não têm relação.
--
-- ── SÓ COMERCIAL, de propósito ──────────────────────────────────────────────
-- Os estágios entram todos com aba='comercial'. Como a aba 'ativacao' não
-- existe para este evento, `abasDaEsteira` devolve [] e a superfície de ativação
-- simplesmente não tem onde aparecer — fail-closed por ausência, não por um `if`
-- espalhado nas telas.
--
-- ── O funil ─────────────────────────────────────────────────────────────────
-- Ponto de partida, para o Victor personalizar depois ("com Kanban a gente vai
-- personalizando"). Enxuto de propósito: é venda direta, sem sinal/saldo, então
-- não herda Boleto Gerado nem Pagamento Parcelado do HM.

-- 1) O evento ---------------------------------------------------------------
insert into cs.eventos (chave, nome, cor, ativo, ordem)
select 'ACELERA', 'Acelera Holding', '#0EA5E9', true, 4
where not exists (select 1 from cs.eventos where chave = 'ACELERA');

-- 2) O funil comercial ------------------------------------------------------
-- Cores seguem a leitura já usada no HM: roxo = entrada, âmbar = espera,
-- azul/ciano = reunião, verde = ganho, rosa = perda.
insert into cs.estagios (evento, chave, nome, aba, ordem, cor, is_inicial, is_final, ativo)
select * from (values
  ('ACELERA','acel_lead',                'Lead',               'comercial', 10, '#a855f7', true,  false, true),
  ('ACELERA','acel_contato_inicial',     'Contato Inicial',    'comercial', 20, '#8b5cf6', false, false, true),
  ('ACELERA','acel_aguardando_retorno',  'Aguardando Retorno', 'comercial', 30, '#f59e0b', false, false, true),
  ('ACELERA','acel_reuniao_agendada',    'Reunião Agendada',   'comercial', 40, '#3b82f6', false, false, true),
  ('ACELERA','acel_reuniao_finalizada',  'Reunião Finalizada', 'comercial', 50, '#06b6d4', false, false, true),
  ('ACELERA','acel_proposta_enviada',    'Proposta Enviada',   'comercial', 60, '#6366f1', false, false, true),
  ('ACELERA','acel_vendido',             'Vendido',            'comercial', 70, '#10b981', false, true,  true),
  ('ACELERA','acel_sem_interesse',       'Sem Interesse',      'comercial', 80, '#e11d48', false, true,  true)
) as v(evento, chave, nome, aba, ordem, cor, is_inicial, is_final, ativo)
where not exists (select 1 from cs.estagios e where e.chave = v.chave);

-- 3) Liberar o portal nas whitelists ----------------------------------------
-- Sem isto, salvar um usuário com o portal novo é RECUSADO pelo CHECK — foi o
-- que a 0170 teve de limpar quando o CNHF saiu. 'CNHF' continua na lista: a
-- tela dele saiu do ar em 10/08 mas as 16 contas antigas ainda podem tê-lo
-- gravado, e derrubar o valor aqui quebraria o save delas.
alter table cs.usuario_portais drop constraint if exists usuario_portais_portal_check;
alter table cs.usuario_portais add constraint usuario_portais_portal_check
  check (portal = any (array['HT','SEM','CNHF','HM','AURUM','ETHB','ACELERA']));

alter table cs.usuario_funcoes drop constraint if exists usuario_funcoes_portal_check;
alter table cs.usuario_funcoes add constraint usuario_funcoes_portal_check
  check (portal = any (array['HT','SEM','CNHF','HM','AURUM','ETHB','ACELERA']));

comment on constraint usuario_portais_portal_check on cs.usuario_portais is
  '0307: ACELERA entra com o portal do Acelera Holding (venda do Curso Nacional).';
