-- 0173_equipe_principal_so_grupo_participa.sql
-- A equipe principal passa a se chamar só "Grupo Participa".
--
-- O "(Pro Max)" veio do seed da 0140 e aparecia na tela para o time inteiro:
-- selo do card, filtro de equipe, tela de equipes, relatório. Pedido do Marcio
-- (10/08): "tá muito escroto esse nome".
--
-- Seguro por desenho: NENHUMA regra de acesso lê o NOME da equipe. Quem governa
-- é o `tipo` ('principal' / 'comum') — ver `ehEquipePrincipal` e
-- `acaoLivrePorEquipeEvento` em lib/papeis.ts. O único ponto que olha texto é
-- `abreviaEquipe` (app/hm/_components/selo-equipe.tsx), que casa por
-- "participa" e continua devolvendo "GP".
--
-- Alcance medido antes: 1 equipe, 14 membros. A outra ("Equipe 2", comum) não é
-- tocada.
-- Idempotente.
update cs.equipes
   set nome = 'Grupo Participa'
 where tipo = 'principal'
   and nome <> 'Grupo Participa';
