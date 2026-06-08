-- =====================================================================
-- 0001_cs_workspace_init  (aplicada em mbvybujpkwuorhtdzcde via MCP)
-- Workspace de Customer Success (HT) — schema `cs`.
-- Reusa public.compradores/compras/ht_editions (não duplica contatos).
-- Server-only: app conecta via role scoped `disparos_app` (GRANT só em `cs`).
--
-- NOTA: substitua __DISPAROS_APP_PASSWORD__ antes de rodar manualmente.
-- =====================================================================
create schema if not exists cs;

-- 1) Jornada configurável -------------------------------------------------
create table if not exists cs.estagios (
  id          smallserial primary key,
  chave       text not null unique,
  nome        text not null,
  ordem       int  not null default 0,
  cor         text,
  is_inicial  boolean not null default false,
  is_final    boolean not null default false,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final) values
  ('novo',              'Novo',              10, '#94a3b8', true,  false),
  ('contatado',         'Contatado',         20, '#3b82f6', false, false),
  ('respondeu',         'Respondeu',         30, '#22c55e', false, false),
  ('em_acompanhamento', 'Em acompanhamento', 40, '#eab308', false, false),
  ('ativado',           'Ativado',           50, '#16a34a', false, true),
  ('sem_retorno',       'Sem retorno',       60, '#ef4444', false, true)
on conflict (chave) do nothing;

-- 2) Overlay de CS por comprador -----------------------------------------
create table if not exists cs.contatos (
  id                  uuid primary key default gen_random_uuid(),
  comprador_id        uuid not null unique references public.compradores(id) on delete cascade,
  estagio_id          smallint references cs.estagios(id),
  responsavel         text,                 -- gancho p/ equipe (sem UI de carteira no v1)
  proxima_acao_em     timestamptz,
  proxima_acao_nota   text,
  observacoes         text,
  primeiro_contato_em timestamptz,
  ultimo_contato_em   timestamptz,
  ultima_resposta_em  timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index if not exists cs_contatos_estagio_idx on cs.contatos (estagio_id);
create index if not exists cs_contatos_proxima_acao_idx on cs.contatos (proxima_acao_em) where proxima_acao_em is not null;

-- 3) Timeline de interações ----------------------------------------------
create table if not exists cs.interacoes (
  id                  uuid primary key default gen_random_uuid(),
  contato_id          uuid not null references cs.contatos(id) on delete cascade,
  tipo                text not null check (tipo in ('disparo','resposta','nota','mudanca_estagio','sistema')),
  descricao           text,
  disparo_id          uuid,
  estagio_anterior_id smallint,
  estagio_novo_id     smallint,
  autor               text,
  criado_em           timestamptz not null default now()
);
create index if not exists cs_interacoes_contato_idx on cs.interacoes (contato_id, criado_em desc);

-- 4) Templates Unnichat ---------------------------------------------------
create table if not exists cs.templates (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  unnichat_id         text not null,
  categoria           text,
  variaveis           int  not null default 0,
  preview             text,
  estagio_sugerido_id smallint references cs.estagios(id),
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now()
);

-- 5) Disparos (campanhas) -------------------------------------------------
create table if not exists cs.disparos (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid references cs.templates(id),
  edicao_ht          text,
  total_enviados     int  not null default 0,
  total_respondidos  int  not null default 0,
  status             text not null default 'em_andamento'
                       check (status in ('em_andamento','concluido','erro')),
  iniciado_em        timestamptz not null default now(),
  concluido_em       timestamptz,
  operador           text not null
);

-- 6) Disparo-contatos -----------------------------------------------------
create table if not exists cs.disparo_contatos (
  id            uuid primary key default gen_random_uuid(),
  disparo_id    uuid not null references cs.disparos(id) on delete cascade,
  comprador_id  uuid references public.compradores(id),
  telefone      text not null,
  enviado       boolean not null default false,
  respondeu     boolean not null default false,
  enviado_em    timestamptz not null default now(),
  respondeu_em  timestamptz,
  sla_minutos   int,
  erro          text
);
create index if not exists cs_disparo_contatos_disparo_idx on cs.disparo_contatos (disparo_id);
create index if not exists cs_disparo_contatos_telefone_idx on cs.disparo_contatos (telefone);
create index if not exists cs_disparo_contatos_pendentes_idx
  on cs.disparo_contatos (telefone, enviado_em desc) where enviado and not respondeu;

-- 7) View curada de contatos HT (única janela do app para o public) -------
-- SECURITY DEFINER (security_invoker=false). "HT buyer" v1 = compra aprovada
-- de ingresso/VIP (1560865 / 2414291). Edição = janela de venda em ht_editions.
create or replace view cs.contatos_ht with (security_invoker = false) as
with ht_compras as (
  select c.comprador_id,
         max(c.data_aprovacao) as ultima_compra_ht,
         (array_agg(c.produto_nome order by c.data_aprovacao desc nulls last))[1] as ultimo_produto
  from public.compras c
  where c.produto_id in ('1560865','2414291')
    and c.status in ('APPROVED','COMPLETE','COMPLETED')
  group by c.comprador_id
)
select
  cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
  hc.ultima_compra_ht, hc.ultimo_produto,
  ed.edition_number,
  coalesce(ed.display_name, case when ed.edition_number is not null then 'HT'||ed.edition_number end) as edicao,
  ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome,
  ct.responsavel, ct.proxima_acao_em, ct.proxima_acao_nota,
  ct.ultimo_contato_em, ct.ultima_resposta_em, ct.observacoes
from ht_compras hc
join public.compradores cmp on cmp.id = hc.comprador_id
left join lateral (
  select e.* from public.ht_editions e
  where hc.ultima_compra_ht between e.sale_start_at and e.sale_end_at
  order by e.edition_number desc limit 1
) ed on true
left join cs.contatos ct on ct.comprador_id = cmp.id
left join cs.estagios est on est.id = ct.estagio_id;

-- 8) Trigger: semeia o contato na esteira em toda nova compra HT aprovada --
create or replace function cs.fn_seed_contato()
returns trigger language plpgsql security definer set search_path = cs, public
as $fn$
declare v_estagio_inicial smallint; v_contato_id uuid;
begin
  if new.produto_id in ('1560865','2414291')
     and new.status in ('APPROVED','COMPLETE','COMPLETED') then
    select id into v_estagio_inicial from cs.estagios where is_inicial order by ordem limit 1;
    insert into cs.contatos (comprador_id, estagio_id)
    values (new.comprador_id, v_estagio_inicial) on conflict (comprador_id) do nothing;
    select id into v_contato_id from cs.contatos where comprador_id = new.comprador_id;
    if v_contato_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_id = v_contato_id and i.tipo = 'sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_id, tipo, descricao, autor)
      values (v_contato_id, 'sistema', 'Entrou na esteira (compra HT aprovada)', 'sistema');
    end if;
  end if;
  return new;
end$fn$;

drop trigger if exists trg_seed_contato on public.compras;
create trigger trg_seed_contato after insert on public.compras
  for each row execute function cs.fn_seed_contato();

-- 9) Backfill dos compradores HT já existentes ---------------------------
insert into cs.contatos (comprador_id, estagio_id)
select distinct cmp.id, (select id from cs.estagios where is_inicial order by ordem limit 1)
from public.compradores cmp
join public.compras c on c.comprador_id = cmp.id
where c.produto_id in ('1560865','2414291') and c.status in ('APPROVED','COMPLETE','COMPLETED')
on conflict (comprador_id) do nothing;

insert into cs.interacoes (contato_id, tipo, descricao, autor)
select ct.id, 'sistema', 'Importado para a esteira (backfill inicial)', 'sistema'
from cs.contatos ct
where not exists (select 1 from cs.interacoes i where i.contato_id = ct.id and i.tipo = 'sistema');

-- 10) Role scoped + RLS ---------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'disparos_app') then
    create role disparos_app login password '__DISPAROS_APP_PASSWORD__';
  else
    alter role disparos_app login password '__DISPAROS_APP_PASSWORD__';
  end if;
end$role$;

grant usage on schema cs to disparos_app;
grant select, insert, update, delete on all tables in schema cs to disparos_app;
grant usage, select on all sequences in schema cs to disparos_app;
alter default privileges in schema cs grant select, insert, update, delete on tables to disparos_app;
alter default privileges in schema cs grant usage, select on sequences to disparos_app;

do $rls$
declare t text;
begin
  foreach t in array array['estagios','contatos','interacoes','templates','disparos','disparo_contatos']
  loop
    execute format('alter table cs.%I enable row level security;', t);
    execute format('drop policy if exists app_all on cs.%I;', t);
    execute format('create policy app_all on cs.%I to disparos_app using (true) with check (true);', t);
  end loop;
end$rls$;
