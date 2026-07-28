-- =====================================================================
-- 0154_usuario_canais
--
-- Canal de aquisição → PESSOA (pedido do Victor via Marcio, 28/07): "definir
-- qual canal de aquisição o colaborador vai cuidar e de qual aluno dentro
-- desses canais". Hoje só existe canal → EQUIPE (cs.equipe_canais). Aqui vem o
-- recorte por PESSOA: um operador "cuida" de um ou mais canais, e passa a VER e
-- AGIR nos cards cuja TAG de canal está atribuída a ele — como se fossem dele
-- (decisão do Marcio: ver E agir), somado ao pool e aos cards próprios.
--
-- Casa pela TAG do card (mesma régua da equipe_canais e da tela de canais): a
-- coluna `canal` guarda a tag exata (ex.: 'HT29 - 26-07', 'HM - Programa de
-- Implementação'). PK composta (usuario_id, canal) — um vínculo por par.
-- Idempotente.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

create table if not exists cs.usuario_canais (
  usuario_id uuid not null references cs.usuarios(id) on delete cascade,
  canal      text not null,
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, canal)
);
comment on table cs.usuario_canais is
  'Canal de aquisição (tag) que uma PESSOA cuida. O operador vê E age nos cards com essa tag, além do pool e dos próprios. Casa por tag, como cs.equipe_canais.';

create index if not exists cs_usuario_canais_canal_idx on cs.usuario_canais (canal);
