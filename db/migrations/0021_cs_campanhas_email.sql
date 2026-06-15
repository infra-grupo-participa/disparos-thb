-- =====================================================================
-- 0021_cs_campanhas_email
-- Espelho das campanhas de e-mail do ActiveCampaign (métricas). É a paridade
-- de e-mail com o WhatsApp: assim como cs.disparos guarda o que saiu pela
-- Unnichat, esta tabela guarda o que saiu pelo AC, isolado por evento (HT/SEM)
-- para os portais lerem separadamente. Idempotente por ac_campaign_id: a
-- sincronização (lib/services/email.ts, via cron) faz upsert e reescreve as
-- contagens a cada passada — o AC não tem webhook de métricas confiável.
--
-- O casamento campanha ↔ evento é por PADRÃO DE NOME (o AC não traz list_id no
-- objeto e segmentname vem vazio): ver classificarEventoEmail() em
-- lib/activecampaign.ts. Campanhas que não casam com nenhum evento ficam com
-- evento = null (não aparecem em nenhum portal).
-- =====================================================================
create table if not exists cs.campanhas_email (
  id               uuid primary key default gen_random_uuid(),
  ac_campaign_id   text not null,                 -- id da campanha no ActiveCampaign
  evento           text,                          -- 'HT' | 'SEM' | null (não casou)
  nome             text not null,
  tipo             text,                          -- single | split | recurring | ...
  status           text,                          -- rótulo do AC (ex.: "Enviado")
  -- Métricas (o AC devolve tudo como string; persistimos como inteiro):
  enviados         integer not null default 0,    -- send_amt
  processados      integer not null default 0,    -- total_amt
  aberturas        integer not null default 0,    -- opens
  aberturas_unicas integer not null default 0,    -- uniqueopens
  cliques          integer not null default 0,    -- linkclicks
  cliques_unicos   integer not null default 0,    -- uniquelinkclicks
  hardbounces      integer not null default 0,
  softbounces      integer not null default 0,
  unsubscribes     integer not null default 0,
  forwards         integer not null default 0,
  replies          integer not null default 0,
  enviada_em       timestamptz,                   -- sdate (data de envio no AC)
  sincronizado_em  timestamptz not null default now(),
  criado_em        timestamptz not null default now()
);

-- Upsert idempotente da sincronização: uma linha por campanha do AC.
create unique index if not exists campanhas_email_ac_id_uidx
  on cs.campanhas_email (ac_campaign_id);

-- O dashboard filtra por evento + período (enviada_em).
create index if not exists campanhas_email_evento_idx
  on cs.campanhas_email (evento, enviada_em desc);

grant select, insert, update, delete on cs.campanhas_email to disparos_app;
alter table cs.campanhas_email enable row level security;
drop policy if exists app_all on cs.campanhas_email;
create policy app_all on cs.campanhas_email to disparos_app using (true) with check (true);
