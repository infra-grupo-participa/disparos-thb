-- =====================================================================
-- 0067_hm_catalogo_de_tags
-- A tag vira cidadã: catálogo com cor, tipo e dono.
--
-- Até aqui a tag era uma string solta no array do card: "existia" enquanto
-- alguém a tivesse, a cor saía de um regex na tela, e renomear/excluir era
-- impossível — não havia onde. O catálogo dá às tags vida própria (estilo
-- Clint): criar antes de usar, cor escolhida, renomear/excluir propagando
-- para todos os cards.
--
-- Tipos:
--   livre   → criada pelo operador. Renomeável e excluível (propaga).
--   sistema → escrita por função do banco (canais de evento, públicos —
--             fn_tag_hm_origem, fn_hm_janela_evento, sync HT ATM…). Atribuível
--             à mão (o operador pode ser a fonte do fato), mas NÃO renomeável
--             nem excluível: as funções gravam esses nomes literais, e um
--             rename órfão faria a próxima venda recriar a tag antiga.
--
-- As tags GERENCIADAS ("Origem …", "Turma …", "Aurum …") ficam FORA do
-- catálogo de propósito: são espelho do campo turma/fatos de origem, uma por
-- turma — cadastrá-las seria ruído, e editá-las à mão já é proibido no serviço.
--
-- `evento` escopa o catálogo (HM hoje; HT quando chegar lá).
-- Aditiva e idempotente.
-- =====================================================================

create table if not exists cs.tags (
  id         uuid primary key default gen_random_uuid(),
  evento     text not null default 'HM',
  nome       text not null,
  cor        text,                       -- hex (#f97316); null = tom neutro da tela
  tipo       text not null default 'livre' check (tipo in ('livre', 'sistema')),
  criado_por text,
  criado_em  timestamptz not null default now(),
  unique (evento, nome)
);

grant select, insert, update, delete on cs.tags to disparos_app;

-- Tags de sistema, com as cores que a tela já usava (regex → catálogo).
insert into cs.tags (evento, nome, cor, tipo) values
  ('HM', 'HT ATM',                         '#f97316', 'sistema'),
  ('HM', 'Live Direto ao Ponto',           '#3b82f6', 'sistema'),
  ('HM', 'Ex aluno Direto ao Ponto',       '#8b5cf6', 'sistema'),
  ('HM', 'HM - Programa de Implementação', '#f59e0b', 'sistema'),
  ('HM', 'Imersão POA',                    '#06b6d4', 'sistema'),
  ('HM', 'Venda direta',                   '#64748b', 'sistema'),
  ('HM', 'HT26',                           '#7c3aed', 'sistema'),
  ('HM', 'HT27',                           '#7c3aed', 'sistema'),
  ('HM', 'HT28',                           '#7c3aed', 'sistema'),
  ('HM', 'Aluno THB',                      '#0ea5e9', 'sistema'),
  ('HM', 'Aluno Aurum',                    '#eab308', 'sistema'),
  ('HM', 'Lead novo',                      '#10b981', 'sistema')
on conflict (evento, nome) do update set tipo = 'sistema', cor = coalesce(cs.tags.cor, excluded.cor);

-- O que já vive nos cards e não é gerenciado entra como livre — nenhuma tag
-- em uso fica órfã de catálogo.
insert into cs.tags (evento, nome, tipo)
select 'HM', t, 'livre'
  from (select distinct unnest(tags) as t from cs.contatos_hm) x
 where t !~ '^(Origem|Turma|Aurum) '
on conflict (evento, nome) do nothing;
