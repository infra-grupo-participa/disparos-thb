-- =====================================================================
-- 0014_cs_ligacoes
-- Registro de ligações telefônicas dos operadores para os leads.
-- Desacoplado do discador: nasce 'concluida' quando registrada à mão
-- (modo tel:) ou 'iniciada' quando disparada por um provedor (Nvoip etc.),
-- e o webhook do provedor atualiza duração/gravação/resultado via
-- provider_call_id. Alimenta o histórico do contato e o painel de ligações.
-- =====================================================================
create table if not exists cs.ligacoes (
  id               uuid primary key default gen_random_uuid(),
  comprador_id     uuid not null,
  operador         text,
  telefone         text not null,
  resultado        text check (resultado in
                     ('atendeu','nao_atendeu','caixa_postal','ocupado','numero_errado')),
  duracao_seg      integer,
  anotacao         text,
  retorno_em       timestamptz,
  url_gravacao     text,
  provider         text not null default 'manual',
  provider_call_id text,
  status           text not null default 'concluida'
                     check (status in ('iniciada','concluida','falhou')),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
grant select, insert, update, delete on cs.ligacoes to disparos_app;
alter table cs.ligacoes enable row level security;
drop policy if exists app_all on cs.ligacoes;
create policy app_all on cs.ligacoes to disparos_app using (true) with check (true);
create index if not exists ix_ligacoes_comprador on cs.ligacoes (comprador_id, criado_em desc);
create index if not exists ix_ligacoes_provider_call on cs.ligacoes (provider_call_id);
create index if not exists ix_ligacoes_retorno on cs.ligacoes (retorno_em) where retorno_em is not null;
