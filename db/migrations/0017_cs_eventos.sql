-- =====================================================================
-- 0017_cs_eventos
-- Eventos da ativação (HT, Seminário, …) — a "camada de contexto" que separa
-- os portais. Cada evento tem seu próprio canal de disparo, templates e o
-- recorte de contatos. O HT existente passa a ser o evento de chave 'HT'.
-- Aditivo: nada que já roda depende desta tabela até a Fase 2 plugar o seletor.
-- =====================================================================
create table if not exists cs.eventos (
  id        uuid primary key default gen_random_uuid(),
  chave     text not null unique,            -- identificador curto e estável: 'HT', 'SEM'
  nome      text not null,                   -- rótulo exibido: 'Holding Total', 'Seminário'
  cor       text,                            -- cor do tema/badge do portal
  ativo     boolean not null default true,
  ordem     integer not null default 0,      -- ordem no seletor
  criado_em timestamptz not null default now()
);

grant select, insert, update, delete on cs.eventos to disparos_app;
alter table cs.eventos enable row level security;
drop policy if exists app_all on cs.eventos;
create policy app_all on cs.eventos to disparos_app using (true) with check (true);

-- Seed: o HT (laranja da marca) e o Seminário (azul). Idempotente.
insert into cs.eventos (chave, nome, cor, ordem) values
  ('HT',  'Holding Total', '#F97316', 0),
  ('SEM', 'Seminário',     '#2563EB', 1)
on conflict (chave) do nothing;
