-- =====================================================================
-- 0023_cs_email_contato
-- Engajamento de e-mail POR PESSOA do sistema (não por campanha). É o que faz o
-- e-mail "refletir para cada pessoa que temos", igual ao disparo de WhatsApp:
-- cada linha liga um comprador do sistema ao seu engajamento real no AC.
--
-- O objeto de contato do AC já traz o engajamento agregado por pessoa
-- (sentcnt, last_open_date, last_click_date, bounced_*), então basta buscar o
-- contato por e-mail e ler esses campos — sem varrer atividades. A
-- sincronização (lib/services/email.ts) roda em lote no cron, espelhando
-- sincronizarStatusRecentes (status de entrega da Meta no WhatsApp).
--
-- O FILTRO POR EVENTO vem do nosso lado: o comprador já pertence a HT/SEM em
-- cs.contatos_evento. Cruzando por comprador_id, o painel mostra "contatos do
-- HT que receberam/abriram/clicaram e-mail" sem precisar separar e-mail por
-- evento no AC.
-- =====================================================================
create table if not exists cs.email_contato (
  comprador_id    uuid primary key,
  ac_contact_id   text,                          -- id do contato no AC (se encontrado)
  encontrado      boolean not null default false, -- achou o e-mail no AC?
  recebidos       integer not null default 0,     -- sentcnt (e-mails enviados à pessoa)
  abriu_em        timestamptz,                    -- last_open_date (null = nunca abriu)
  clicou_em       timestamptz,                    -- last_click_date (null = nunca clicou)
  bounce_hard     integer not null default 0,
  bounce_soft     integer not null default 0,
  sincronizado_em timestamptz not null default now()
);

-- Prioriza o lote do cron: nunca sincronizados primeiro, depois os mais antigos.
create index if not exists email_contato_sync_idx on cs.email_contato (sincronizado_em asc);

grant select, insert, update, delete on cs.email_contato to disparos_app;
alter table cs.email_contato enable row level security;
drop policy if exists app_all on cs.email_contato;
create policy app_all on cs.email_contato to disparos_app using (true) with check (true);
