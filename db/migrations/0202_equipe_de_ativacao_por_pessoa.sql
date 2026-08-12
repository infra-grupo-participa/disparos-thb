-- 0202 — "equipe de ativação" vira uma FUNÇÃO por pessoa, não um tipo de equipe.
--
-- ── O PEDIDO (Marcio, 12/08/2026) ───────────────────────────────────────────────
--   "quando o card for movido para a ativação, todo e qualquer card movido para a
--    ativação, a Ana Camila e o Thomas podem ver, pois eles são da equipe de ativação"
--
-- ── O PROBLEMA COM "EQUIPE PRINCIPAL" ───────────────────────────────────────────
-- A regra da esteira compartilhada (12/08) usa `equipe_tipo = 'principal'` como
-- criterio. So que a equipe "Grupo Participa" tem 14 pessoas ATIVAS: Aldri, Ana
-- Camila, Arthur, Elaine, Fernanda, Isabela, Joao Pedro, Jonathan, Jusy, Marcio,
-- Marco, Terceriza CS, Thomas e Victor Hugo.
--
-- Ou seja: "principal" libera a Ativacao para as 14, e o pedido nomeia 2. A equipe
-- de ativacao NAO e a equipe principal — e um subconjunto dela, e um subconjunto
-- que muda (entra gente, sai gente) sem que o tipo da equipe mude.
--
-- Modelar isso como tipo de equipe teria dois efeitos ruins:
--   · alcance grande demais hoje (12 pessoas a mais do que o pedido)
--   · toda mudanca no time viraria migration + deploy
--
-- ── A SOLUCAO: uma marca por PESSOA ─────────────────────────────────────────────
-- `cs.usuarios.equipe_ativacao` responde exatamente a pergunta do negocio: "esta
-- pessoa e da equipe de ativacao?". Ligar/desligar e um UPDATE — a 3a pessoa que
-- entrar no time nao precisa de deploy.
--
-- Mesmo espirito do `gerente_distribuidor` (0161) e do `lider_equipe` (0143): quando
-- a capacidade e de PESSOA, ela mora no usuario, nao no tipo da equipe.

alter table cs.usuarios
  add column if not exists equipe_ativacao boolean not null default false;

comment on column cs.usuarios.equipe_ativacao is
  '0202: pessoa da EQUIPE DE ATIVACAO — ve e move TODO card que chega na aba Ativacao do HM, inclusive de outra equipe (pedido do Marcio 12/08). Nao da posse do card (assumir continua travado) nem permissao de disparo. Ligar/desligar por UPDATE: o time muda sem deploy.';

-- Ana Camila e Thomas — os dois nomeados no pedido.
-- Por e-mail, nao por id: id de usuario nao e estavel entre ambientes.
update cs.usuarios
   set equipe_ativacao = true
 where lower(email) in ('anacamila@advmais.com', 'thomas@advmais.com');

-- ── A VISAO QUE EXPLICA A REGRA ─────────────────────────────────────────────────
-- Quem tem o bonus, e o que ele alcanca. Serve de documentacao viva e de conferencia
-- rapida ("por que fulano esta vendo esse card?") sem ler o codigo do predicado.
create or replace view cs.vw_equipe_ativacao as
  select u.id as usuario_id, u.nome, u.email, u.papel,
         e.nome as equipe, e.tipo as equipe_tipo,
         u.equipe_ativacao,
         (select count(*) from cs.contatos_hm_kanban k
           where k.produto = 'HM' and k.estagio_aba = 'ativacao') as cards_alcancados
    from cs.usuarios u
    left join cs.equipes e on e.id = u.equipe_id
   where u.ativo and u.equipe_ativacao;

comment on view cs.vw_equipe_ativacao is
  '0202: quem esta na equipe de ativacao e quantos cards da aba Ativacao do HM a regra alcanca. Conferencia rapida de "por que fulano ve esse card".';

grant select on cs.vw_equipe_ativacao to disparos_app;

-- ── O QUE ESTA REGRA NAO DA (limites explicitos, decisao do Marcio 12/08) ───────
--   · NAO da posse: assumir/reatribuir card de outra equipe continua travado
--     (atribuicao_travada em lib/services/hm.ts). Ver e mover ≠ tomar para si.
--   · NAO da disparo: /api/send e /api/disparos/elegiveis seguem fora — mesmo
--     corte que ja vale para gerente_distribuidor. "Gerencia sobre o card" ≠
--     "permissao de mandar campanha para a base".
--   · NAO cobre a aba COMERCIAL: 167 dos 262 cards do HM estao la e ficam
--     intactos — territorio da equipe dona do card.
--   · NAO cobre AURUM/ETHB: mesmo evento HM, produto diferente. So o produto 'HM'.
--
-- ALCANCE MEDIDO hoje: 95 cards na aba Ativacao do HM, dos quais 12 sao de outra
-- equipe (Kelly / Equipe 2) — esses 12 sao o ganho real, hoje invisiveis para a
-- Ana Camila e o Thomas. 3 estao sem dono. Os 167 do comercial nao mudam.
