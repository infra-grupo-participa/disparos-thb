-- =====================================================================
-- 0143_hm_lider_equipe
--
-- ADM de equipe (decisão do Marcio, 27/07). Hoje só existe admin GLOBAL
-- (papel='admin', faz tudo). Falta a figura do "líder da própria equipe":
-- um operador que DISTRIBUI cards entre os operadores da equipe DELE, mas
-- não toca em card do Grupo Participa nem de outra equipe.
--
-- `lider_equipe` marca esse papel escopado. Hierarquia resultante:
--   - admin global (numa equipe principal/GP) = master: vê e distribui tudo.
--   - lider_equipe (numa equipe comum) = distribui dentro da própria equipe.
--   - operador = só assume card do pool; não reatribui.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================
alter table cs.usuarios
  add column if not exists lider_equipe boolean not null default false;

comment on column cs.usuarios.lider_equipe is
  'true = líder/ADM da própria equipe: distribui cards entre os operadores da equipe dele (não toca GP nem outra equipe).';
