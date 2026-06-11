-- =====================================================================
-- 0012_cs_config
-- Configurações dinâmicas (chave → valor JSON). Tira valores do hardcode e dá
-- base para a "central de configurações". Lido via lib/services/config.ts com
-- cache curto e fallback para o default no código.
-- =====================================================================
create table if not exists cs.config (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
grant select, insert, update, delete on cs.config to disparos_app;
alter table cs.config enable row level security;
drop policy if exists app_all on cs.config;
create policy app_all on cs.config to disparos_app using (true) with check (true);

insert into cs.config (chave, valor) values ('inbox.sla_min', '15'::jsonb)
on conflict (chave) do nothing;
