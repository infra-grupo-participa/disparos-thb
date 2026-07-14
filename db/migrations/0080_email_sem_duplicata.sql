-- =====================================================================
-- 0080_email_sem_duplicata
-- O mesmo defeito de corrida que 0074 consertou no WhatsApp existe no e-mail:
-- retomarTravadosEmail() elege por `iniciado_em < now() - 15min`, sem saber se o
-- processo original ainda está vivo. No e-mail a consequência é pior — dois
-- processos no mesmo disparo criam DUAS campanhas no AC, e o contato recebe o
-- e-mail duas vezes.
--
-- Mesma solução: heartbeat. Quem processa reivindica; o cron só assume o que
-- parou de bater.
-- =====================================================================
alter table cs.disparos_email add column if not exists processando_em timestamptz;

comment on column cs.disparos_email.processando_em is
  'Heartbeat do processo que está disparando. O cron só retoma quando este relógio para de bater (ver lib/services/email.ts).';

create index if not exists ix_disparos_email_processando
  on cs.disparos_email (processando_em) where status = 'em_andamento';

-- Um contato, uma linha por disparo de e-mail (espelha 0074 no WhatsApp).
delete from cs.disparo_email_contatos dec
 using cs.disparo_email_contatos manter
 where dec.disparo_id = manter.disparo_id
   and dec.comprador_id = manter.comprador_id
   and dec.comprador_id is not null
   and dec.id <> manter.id
   and (manter.enviado, manter.id) > (dec.enviado, dec.id);

create unique index if not exists ux_disparo_email_contatos_disparo_comprador
  on cs.disparo_email_contatos (disparo_id, comprador_id) where comprador_id is not null;

-- Por que o disparo falhou, em texto. O disparo por campanha morre por motivos
-- que o operador precisa LER (o AC recusou o remetente, a lista não subiu, a
-- campanha não foi aceita) — sem isto, o painel só mostra 'erro' e ninguém sabe
-- o que fazer.
alter table cs.disparos_email add column if not exists erro text;
