-- =====================================================================
-- 0018_cs_canais_disparo
-- Canais de disparo (credenciais da API de WhatsApp) por evento. Tira a chave
-- do hardcode/env e deixa o admin trocar de número/API em segundos quando um
-- número é queimado — sem redeploy. Lido por lib/services/canais.ts, que cai
-- para a env (UNNICHAT_API_KEY) enquanto não houver canal ativo no banco, para
-- não quebrar o HT que já roda.
-- =====================================================================
create table if not exists cs.canais_disparo (
  id            uuid primary key default gen_random_uuid(),
  evento_chave  text not null references cs.eventos (chave) on update cascade,
  nome          text not null,                       -- rótulo amigável: "Número principal HT"
  provider      text not null default 'unnichat',
  base_url      text,                                -- null => default do provider (unnichat.com.br/api)
  api_key       text not null,
  numero        text,                                -- número do WhatsApp (referência visual)
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- No máximo um canal ATIVO por (evento, provider) — é o que será usado no envio.
-- Trocar de número = desativar o atual e ativar o novo (ou editar a chave).
create unique index if not exists canais_disparo_ativo_uidx
  on cs.canais_disparo (evento_chave, provider) where ativo;

grant select, insert, update, delete on cs.canais_disparo to disparos_app;
alter table cs.canais_disparo enable row level security;
drop policy if exists app_all on cs.canais_disparo;
create policy app_all on cs.canais_disparo to disparos_app using (true) with check (true);
