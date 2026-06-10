-- =====================================================================
-- 0011_cs_inbox_atendimento
-- Atendimento no Inbox: status da conversa + tempo de primeiro contato (FRT).
-- inbox_status: sem_conversa | pendente (lead falou, aguardando CS) | resolvido.
-- Cada resposta do CS a uma pendência gera um registro em cs.atendimentos com
-- o FRT (minutos entre a fala do lead e a resposta do CS), para as métricas de
-- desempenho do CS (tempo de 1º contato, SLA, volume por atendente).
-- =====================================================================
alter table cs.contatos add column if not exists inbox_status text not null default 'sem_conversa';
alter table cs.contatos add column if not exists aguardando_desde timestamptz;
create index if not exists cs_contatos_inbox_status_idx on cs.contatos (inbox_status) where inbox_status = 'pendente';

create table if not exists cs.atendimentos (
  id            uuid primary key default gen_random_uuid(),
  comprador_id  uuid references public.compradores(id) on delete cascade,
  atendente     text,
  pergunta_em   timestamptz,
  respondido_em timestamptz not null default now(),
  frt_minutos   int,
  criado_em     timestamptz not null default now()
);
create index if not exists cs_atendimentos_resp_idx on cs.atendimentos (respondido_em desc);
create index if not exists cs_atendimentos_atendente_idx on cs.atendimentos (atendente);

grant select, insert, update, delete on cs.atendimentos to disparos_app;
alter table cs.atendimentos enable row level security;
drop policy if exists app_all on cs.atendimentos;
create policy app_all on cs.atendimentos to disparos_app using (true) with check (true);
