-- =====================================================================
-- 0153_portais_aurum_ethb
--
-- Novos portais AURUM e ETHB (pedido do Victor via Marcio, 28/07): o admin
-- precisa poder liberar/restringir acesso a Aurum e ETHB por conta, como já faz
-- com HT/SEM/CNHF/HM (controle por portal da 0145). Aqui só ampliamos o CHECK
-- de cs.usuario_portais para aceitar os dois novos valores; a identidade visual
-- e o roteamento entram no código (lib/marcas, validators, papeis, use-portal).
--
-- NÃO damos os portais novos a ninguém automaticamente: diferente da 0145 (que
-- fez backfill dos 4 portais existentes para não trancar ninguém), Aurum/ETHB
-- são áreas NOVAS — cada conta recebe pela tela /usuarios quando a área existir.
-- Idempotente.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

alter table cs.usuario_portais drop constraint if exists usuario_portais_portal_check;
alter table cs.usuario_portais
  add constraint usuario_portais_portal_check
  check (portal = any (array['HT','SEM','CNHF','HM','AURUM','ETHB']));
