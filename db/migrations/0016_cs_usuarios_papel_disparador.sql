-- =====================================================================
-- 0016_cs_usuarios_papel_disparador
-- Adiciona o papel 'disparador' aos níveis de acesso. Hierarquia:
--   admin       — acesso total (gestão de usuários + disparos).
--   disparador  — operador que TAMBÉM pode efetuar disparos.
--   operador    — opera o Kanban/contatos/inbox, mas NÃO dispara.
-- A regra "pode disparar" (admin OU disparador) é aplicada no backend
-- (app/api/send) e espelhada na UI. Ver lib/auth.ts (podeDisparar).
-- =====================================================================
alter table cs.usuarios drop constraint if exists usuarios_papel_check;
alter table cs.usuarios
  add constraint usuarios_papel_check
  check (papel in ('admin', 'disparador', 'operador'));
