-- =====================================================================
-- 0145_usuario_portais
--
-- Controle de acesso POR PORTAL por conta (decisao do Marcio, 27/07). Hoje
-- qualquer conta logada entra em qualquer portal pela URL — gera confusao.
-- Agora cada conta tem uma whitelist de portais (HT/SEM/CNHF/HM); quem nao tem
-- o portal na lista nao entra nem ve. Gerido pelos admins do Grupo Participa.
--
-- Regra: conta NOVA nasce restrita (sem portais — o admin libera). Mas os
-- usuarios ATUAIS recebem TODOS os portais no backfill, para o gate nao trancar
-- ninguem que ja usa o sistema.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================
create table if not exists cs.usuario_portais (
  usuario_id uuid not null references cs.usuarios(id) on delete cascade,
  portal     text not null check (portal in ('HT','SEM','CNHF','HM')),
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, portal)
);

comment on table cs.usuario_portais is
  'Whitelist de portais por conta (HT/SEM/CNHF/HM). Sem linha = sem acesso. Gerido pelo admin do GP.';

grant select, insert, update, delete on cs.usuario_portais to disparos_app;
alter table cs.usuario_portais enable row level security;
drop policy if exists app_all on cs.usuario_portais;
create policy app_all on cs.usuario_portais to disparos_app using (true) with check (true);

-- Backfill: todo usuario ATUAL ganha TODOS os portais (preserva o acesso de hoje).
-- Contas criadas DEPOIS desta migration nascem sem linha = restritas.
insert into cs.usuario_portais (usuario_id, portal)
select u.id, p.portal
  from cs.usuarios u
  cross join (values ('HT'),('SEM'),('CNHF'),('HM')) as p(portal)
on conflict do nothing;
