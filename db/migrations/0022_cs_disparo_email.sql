-- =====================================================================
-- 0022_cs_disparo_email
-- Disparo de e-mail pelo ActiveCampaign. Mecanismo (decisão 2026-06-15): o
-- sistema aplica uma TAG no contato (POST /api/3/contactTags) e a automação do
-- AC ligada àquela tag envia o e-mail — é como a conta já opera (gatilhos
-- 'tagadd'). A API v3 do AC não faz broadcast direto.
--
-- 1) cs.templates ganha canal + ac_tag_id: reaproveita a UI de templates. Um
--    "template de e-mail" (canal='email') aponta para a tag do AC (ac_tag_id)
--    em vez de um template da Unnichat. Os templates de WhatsApp seguem como
--    canal='whatsapp' (default → preserva o existente).
-- 2) Tabelas próprias de disparo de e-mail (cs.disparos_email / _contatos), em
--    vez de reusar cs.disparos: assim o log de e-mail NÃO contamina as métricas
--    e o anti-ban do WhatsApp (que leem cs.disparos sem filtrar canal). As
--    métricas de engajamento (abertura/clique) continuam vindo do sync de
--    campanhas em cs.campanhas_email.
-- =====================================================================
alter table cs.templates add column if not exists canal     text not null default 'whatsapp';
alter table cs.templates add column if not exists ac_tag_id text; -- id da tag no AC (canal='email')

-- Log de disparos de e-mail (cabeçalho), espelho leve de cs.disparos.
create table if not exists cs.disparos_email (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid references cs.templates (id),
  evento          text not null default 'HT',
  edicao_ht       text,
  status          text not null default 'em_andamento', -- em_andamento | concluido | erro
  total_contatos  integer not null default 0,
  total_enviados  integer not null default 0,            -- tags aplicadas com sucesso
  total_erros     integer not null default 0,
  operador        text,
  iniciado_em     timestamptz not null default now(),
  concluido_em    timestamptz
);

-- Linhas por contato (rastreio do disparo). "enviado" = tag aplicada no AC
-- (automação acionada). O engajamento real fica nas métricas de campanha.
create table if not exists cs.disparo_email_contatos (
  id            uuid primary key default gen_random_uuid(),
  disparo_id    uuid not null references cs.disparos_email (id) on delete cascade,
  comprador_id  uuid,
  email         text not null,
  ac_contact_id text,                                    -- id do contato no AC (após sync)
  enviado       boolean not null default false,
  enviado_em    timestamptz,
  erro          text
);

create index if not exists disparos_email_evento_idx on cs.disparos_email (evento, iniciado_em desc);
create index if not exists disparo_email_contatos_disparo_idx on cs.disparo_email_contatos (disparo_id);

grant select, insert, update, delete on cs.disparos_email to disparos_app;
grant select, insert, update, delete on cs.disparo_email_contatos to disparos_app;
alter table cs.disparos_email enable row level security;
alter table cs.disparo_email_contatos enable row level security;
drop policy if exists app_all on cs.disparos_email;
drop policy if exists app_all on cs.disparo_email_contatos;
create policy app_all on cs.disparos_email to disparos_app using (true) with check (true);
create policy app_all on cs.disparo_email_contatos to disparos_app using (true) with check (true);
