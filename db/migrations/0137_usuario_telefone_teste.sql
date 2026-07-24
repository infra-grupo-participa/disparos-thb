-- =====================================================================
-- 0137_usuario_telefone_teste
-- Telefone do operador, para o "enviar teste para o meu WhatsApp" na tela de
-- Templates: o SDR vê a mensagem chegar no próprio número antes de disparar em
-- massa. Guardado uma vez, reusado sempre. Opcional (nullable).
-- =====================================================================
alter table cs.usuarios add column if not exists telefone text;
