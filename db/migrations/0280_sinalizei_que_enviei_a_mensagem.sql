-- =====================================================================
-- 0280_sinalizei_que_enviei_a_mensagem
--
-- D1 (decisão do Marcio): "Contato Inicial" (hm_comprou) é o card que
-- CHEGOU — ninguém falou com o comprador ainda. O gesto do operador
-- "sinalizei que enviei a mensagem" é o que MOVE o card de hm_comprou para
-- hm_aguardando_retorno (o serviço faz o UPDATE de estágio; esta migration
-- só cria o carimbo do gesto em si).
--
-- `contato_inicial_em` = quando o operador marcou que já mandou a primeira
-- mensagem. NÃO é "quando a Hotmart confirmou a compra" (isso é
-- `cs.contatos_hm.criado_em`) nem "quando alguém finalmente atendeu" (a
-- reunião tem carimbo próprio) — é só o gesto humano intermediário.
--
-- SEM BACKFILL, de propósito (decisão explícita, D1/tarefa): os cards que já
-- passaram por "Contato Inicial" antes desta coluna existir NÃO têm como
-- provar que o sinal foi dado — nasceriam com `contato_inicial_em = null`,
-- que é exatamente o valor de "ninguém sinalizou ainda". Ficam iguais aos
-- dois estados: card antigo sem sinal e card novo sem sinal são
-- indistinguíveis no dado, e não dá pra inventar uma data que o sistema
-- nunca observou. É diferente de "não contatado": pode ter havido contato
-- fora da tela (telefonema, WhatsApp direto) que o sistema não registrou.
--
-- Aditiva e idempotente.
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists contato_inicial_em timestamptz;

comment on column cs.contatos_hm.contato_inicial_em is
  '0280: carimbo do gesto "sinalizei que enviei a mensagem" (D1) — o operador confirmou que já mandou a primeira abordagem ao comprador. Move o card de hm_comprou para hm_aguardando_retorno (lib/services/hm.ts). NULL = ninguém sinalizou ainda (inclui todo card criado antes desta coluna existir — sem backfill, de propósito: não dá para afirmar que não houve contato, só que não há SINAL registrado).';
