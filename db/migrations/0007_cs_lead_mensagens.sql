-- =====================================================================
-- 0007_cs_lead_mensagens
-- Base de inteligência de comportamento: cada mensagem trocada com o lead,
-- já classificada (assunto, categoria, sentimento). Alimentada por:
--   (a) sincronização do histórico da Unnichat (GET /contact/{id}/messages)
--   (b) webhook em tempo real (toda nova resposta)
-- Idempotente por unnichat_message_id. Server-only (role disparos_app).
-- =====================================================================
create table if not exists cs.lead_mensagens (
  id                   uuid primary key default gen_random_uuid(),
  unnichat_message_id  text unique,                       -- idempotência do sync
  comprador_id         uuid references public.compradores(id) on delete set null,
  telefone_norm        text not null,
  direcao              text not null check (direcao in ('lead','cs')),
  texto                text,
  assunto              text,                              -- tema dominante (classificado)
  categoria            text,                              -- tipo de resposta (classificado)
  sentimento           text check (sentimento in ('positivo','neutro','negativo')),
  enviada_em           timestamptz,                       -- data da mensagem na Unnichat
  criado_em            timestamptz not null default now()
);

create index if not exists cs_lead_msg_enviada_idx   on cs.lead_mensagens (enviada_em desc);
create index if not exists cs_lead_msg_assunto_idx    on cs.lead_mensagens (assunto)   where direcao = 'lead';
create index if not exists cs_lead_msg_categoria_idx  on cs.lead_mensagens (categoria) where direcao = 'lead';
create index if not exists cs_lead_msg_comprador_idx  on cs.lead_mensagens (comprador_id);
create index if not exists cs_lead_msg_telefone_idx   on cs.lead_mensagens (telefone_norm);

-- Controle de sincronização por contato (para sync incremental e observabilidade).
create table if not exists cs.sync_conversas (
  telefone_norm        text primary key,
  unnichat_contact_id  text,
  ultima_sincronizacao timestamptz,
  total_mensagens      int not null default 0,
  ultimo_erro          text
);

-- Grants + RLS (mesmo padrão das demais tabelas de cs).
grant select, insert, update, delete on cs.lead_mensagens to disparos_app;
grant select, insert, update, delete on cs.sync_conversas to disparos_app;

alter table cs.lead_mensagens enable row level security;
alter table cs.sync_conversas enable row level security;
drop policy if exists app_all on cs.lead_mensagens;
drop policy if exists app_all on cs.sync_conversas;
create policy app_all on cs.lead_mensagens to disparos_app using (true) with check (true);
create policy app_all on cs.sync_conversas to disparos_app using (true) with check (true);
