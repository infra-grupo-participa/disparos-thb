-- =====================================================================
-- 0027_cs_ac_automacoes
-- "Raio-x da automação": espelho do CABLEAMENTO tag → automação do
-- ActiveCampaign, para o sistema mostrar — na hora de escolher a tag de um
-- template e na hora de disparar — se aquela tag realmente envia e-mail.
--
-- Motivação (incidente 2026-06-16): o template "ht_email_oferta" aponta para a
-- tag 303 ("[HT] Oferta 01/02"), mas NENHUMA automação do AC tem gatilho nessa
-- tag — então aplicar a tag não envia nada. E a automação que mandaria a oferta
-- ("[HT] Oferta Direta") dispara em OUTRA tag e ainda está pausada. O operador
-- criou o template às cegas. Esta tabela acaba com isso.
--
-- O gatilho do AC (automationTriggers, type='tagadd') casa a automação à tag
-- pelo NOME da tag (não pelo id) — por isso guardamos trigger_tag (nome) aqui e
-- o NOME da tag no template (cs.templates.ac_tag_nome). Sincronizado pelo cron
-- (lib/services/ac-automacoes.ts), idempotente. Uma linha por (automação, tag de
-- gatilho): uma automação pode ter vários gatilhos de tag.
-- =====================================================================
alter table cs.templates add column if not exists ac_tag_nome text; -- nome da tag no AC (gatilho casa por nome)

create table if not exists cs.ac_automacoes (
  id                uuid primary key default gen_random_uuid(),
  ac_automation_id  text not null,                 -- id da automação no AC
  nome              text not null,
  status            text,                          -- bruto do AC: '1' ativa | '2' pausada
  ativa             boolean not null default false, -- status == '1'
  trigger_tag       text not null default '',      -- NOME da tag do gatilho 'tagadd' ('' = gatilho não-tag)
  multientry        boolean not null default true, -- false = contato entra só uma vez
  entrou            integer not null default 0,    -- quantos contatos já entraram (contexto)
  sincronizado_em   timestamptz not null default now(),
  criado_em         timestamptz not null default now()
);

-- Upsert idempotente: uma linha por automação + tag de gatilho.
create unique index if not exists ac_automacoes_uidx
  on cs.ac_automacoes (ac_automation_id, trigger_tag);

-- Casamento por NOME da tag (template.ac_tag_nome → automação que escuta).
create index if not exists ac_automacoes_trigger_tag_idx
  on cs.ac_automacoes (trigger_tag);

grant select, insert, update, delete on cs.ac_automacoes to disparos_app;
alter table cs.ac_automacoes enable row level security;
drop policy if exists app_all on cs.ac_automacoes;
create policy app_all on cs.ac_automacoes to disparos_app using (true) with check (true);
