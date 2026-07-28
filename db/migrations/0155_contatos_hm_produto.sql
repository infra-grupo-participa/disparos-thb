-- =====================================================================
-- 0155_contatos_hm_produto
--
-- FUNDAÇÃO da esteira multi-produto (frentes 5-6, pedido do Victor via Marcio):
-- Aurum e ETHB ganham board PRÓPRIO reusando a esteira do HM (mesmos estágios,
-- mesmos componentes) — separados por um discriminador de PRODUTO no card, não
-- por tabela nova. Decisão de arquitetura (b): aditivo, protege o HM em produção.
--
-- Decisões do Marcio (28/07):
--   • UM card por pessoa → mantém UNIQUE(comprador_id); NÃO troca a chave.
--   • Mesma esteira do HM → reusa cs.estagios evento='HM'; sem estágios novos.
--   • Cards atuais FICAM no HM → backfill 'HM' para todos; um card só nasce
--     Aurum/ETHB por COMPRA nova do produto (o seed carimba — migration à parte).
--
-- Esta migration é SÓ a coluna + a exposição na view. Nenhuma query passa a
-- filtrar por produto aqui: com todos os cards em 'HM' e o board HM sem filtro,
-- o comportamento é idêntico ao de hoje. O filtro por produto entra nas rotas
-- dos boards novos (Aurum/ETHB) e no board HM quando estes existirem.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists produto text not null default 'HM'
  check (produto in ('HM','AURUM','ETHB'));

comment on column cs.contatos_hm.produto is
  'Produto/board a que o card pertence: HM (default, tudo que existe hoje), AURUM ou ETHB. Um card só nasce Aurum/ETHB por compra nova do produto (seed). Mesma esteira/estágios do HM.';

create index if not exists cs_contatos_hm_produto_idx on cs.contatos_hm (produto);
