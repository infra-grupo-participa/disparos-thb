-- =====================================================================
-- 0079_email_campanha_direta
-- O disparo de e-mail aplicava uma tag no contato e TORCIA para que uma
-- automação do AC a capturasse. Isso obriga a montar uma automação lá dentro a
-- cada campanha — e, quando o cabo tag→automação está solto, o e-mail
-- simplesmente não sai (foi o incidente de 2026-06-16, ver 0027).
--
-- Agora o operador escreve assunto e corpo AQUI, e o disparo cria a mensagem e
-- lança a campanha no AC. Sem automação nenhuma.
--
-- Os dois modos convivem: `modo` diz qual é qual. Os templates que já existem
-- ficam em 'tag' e continuam funcionando exatamente como antes.
-- =====================================================================

-- ----- O corpo do e-mail mora no template -----------------------------
alter table cs.templates add column if not exists modo             text not null default 'tag';
alter table cs.templates add column if not exists assunto          text;
alter table cs.templates add column if not exists corpo_html       text;
alter table cs.templates add column if not exists corpo_texto      text;

alter table cs.templates drop constraint if exists cs_templates_modo_chk;
alter table cs.templates add constraint cs_templates_modo_chk
  check (modo in ('tag', 'campanha'));

comment on column cs.templates.modo is
  'tag = aplica ac_tag_id e depende de automação no AC (legado). campanha = cria a mensagem e lança a campanha pela API v1, sem automação.';
comment on column cs.templates.corpo_html is
  'HTML do e-mail. Personalização usa as tags nativas do AC (%FIRSTNAME%), resolvidas por ele no envio.';

-- ----- Rastro do que o disparo criou lá dentro -------------------------
-- Guardar o ac_campaign_id é o que casa o disparo com a campanha em
-- cs.campanhas_email: as métricas (abertura, clique, bounce) chegam pelo cron
-- que já existe e passam a valer POR DISPARO, sem trabalho extra.
alter table cs.disparos_email add column if not exists ac_campaign_id text;
alter table cs.disparos_email add column if not exists ac_message_id  text;
alter table cs.disparos_email add column if not exists ac_list_id     text;

create index if not exists ix_disparos_email_ac_campaign
  on cs.disparos_email (ac_campaign_id) where ac_campaign_id is not null;

-- A lista técnica do disparo é onde o descadastro cai. O cron varre as recentes
-- para trazer os opt-outs de volta (cs.contatos.opt_out) — ver lib/services/email.ts.
create index if not exists ix_disparos_email_ac_list
  on cs.disparos_email (ac_list_id) where ac_list_id is not null;

-- Quando os descadastros daquela lista foram lidos pela última vez.
alter table cs.disparos_email add column if not exists optout_sincronizado_em timestamptz;
