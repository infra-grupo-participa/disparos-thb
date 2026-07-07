-- =====================================================================
-- 0028_cs_hm_ativacao
-- Módulo de Ativação Holding Masters (evento 'HM', turma T39). Replica o
-- modelo de esteira do HT como um NOVO evento/portal, porém SEM disparos:
-- só Kanban (2 abas: Comercial/Ativação), Ficha e Agendamentos.
--
-- Fonte = compras HM catalogadas em public.hm_product_catalog:
--   categoria 'sinal' e 'compra_cheia'  → ENTRAM no kanban (estágio hm_comprou)
--   categoria 'diferenca' (saldo 14.700) → marca PAGAMENTO REALIZADO (→ Ativação)
--   categoria 'renovacao' / 'reserva'    → IGNORADAS (não entram)
--
-- Isolamento: um comprador pode ser HT e HM ao mesmo tempo (≈1/3 dos casos),
-- e cs.contatos é UNIQUE(comprador_id). Para não colidir/corromper o HT
-- (produção), o HM usa um overlay PRÓPRIO: cs.contatos_hm. O HT/SEM não são
-- tocados. A timeline (cs.interacoes) e os formulários (cs.formularios) são
-- reaproveitados.
-- Aditiva e idempotente.
-- =====================================================================

-- 1) Evento HM (portal) -----------------------------------------------------
insert into cs.eventos (chave, nome, cor, ordem) values
  ('HM', 'Holding Masters', '#B45309', 2)
on conflict (chave) do update set nome = excluded.nome, cor = excluded.cor, ativo = true;

-- 2) Abas dos estágios (só HM usa; HT/SEM ficam null = aba única) -----------
alter table cs.estagios add column if not exists aba text;

-- 3) Estágios HM (chaves globais únicas; duas abas via `aba`) ----------------
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba) values
  ('hm_comprou',              'Comprou HM',           10, '#a855f7', true,  false, true, 'HM', 'comercial'),
  ('hm_reuniao_agendada',     'Reunião Agendada',     20, '#3b82f6', false, false, true, 'HM', 'comercial'),
  ('hm_reuniao_finalizada',   'Reunião Finalizada',   30, '#06b6d4', false, false, true, 'HM', 'comercial'),
  ('hm_pagamento_realizado',  'Pagamento Realizado',  40, '#10b981', false, false, true, 'HM', 'comercial'),
  ('hm_entrevista_agendada',  'Entrevista Agendada',  50, '#f59e0b', false, false, true, 'HM', 'ativacao'),
  ('hm_entrevista_realizada', 'Entrevista Realizada', 60, '#6366f1', false, false, true, 'HM', 'ativacao'),
  ('hm_acesso_liberado',      'Acesso Liberado',      70, '#16a34a', false, true,  true, 'HM', 'ativacao')
on conflict (chave) do update set
  nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
  is_inicial = excluded.is_inicial, is_final = excluded.is_final, ativo = true,
  evento = excluded.evento, aba = excluded.aba;

-- 4) Hardening do seed do HT ------------------------------------------------
-- O trigger do HT selecionava `is_inicial order by ordem limit 1` SEM filtrar
-- evento — com HM (e SEM) tendo estágio inicial na mesma ordem, isso era
-- ambíguo. Fixa em evento='HT' (determinístico). Comportamento do HT idêntico.
create or replace function cs.fn_seed_contato()
returns trigger language plpgsql security definer set search_path = cs, public
as $fn$
declare
  v_estagio_inicial smallint;
  v_contato_id uuid;
begin
  if new.produto_id in ('1560865','2414291')
     and new.status in ('APPROVED','COMPLETE','COMPLETED') then
    select id into v_estagio_inicial
      from cs.estagios where is_inicial and evento = 'HT' order by ordem limit 1;

    insert into cs.contatos (comprador_id, estagio_id)
    values (new.comprador_id, v_estagio_inicial)
    on conflict (comprador_id) do nothing;

    select id into v_contato_id from cs.contatos where comprador_id = new.comprador_id;

    if v_contato_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_id = v_contato_id and i.tipo = 'sistema'
        and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_id, tipo, descricao, autor)
      values (v_contato_id, 'sistema', 'Entrou na esteira (compra HT aprovada)', 'sistema');
    end if;
  end if;
  return new;
end$fn$;

-- 5) Overlay de CS do HM (uma linha por comprador, isolado do HT) -----------
create table if not exists cs.contatos_hm (
  id                    uuid primary key default gen_random_uuid(),
  comprador_id          uuid not null unique references public.compradores(id) on delete cascade,
  estagio_id            smallint references cs.estagios(id),
  responsavel           text,
  turma                 text,                 -- ex.: 'T39'
  plano                 text,                 -- plano contratado (derivado da oferta)
  categoria_entrada     text,                 -- 'sinal' | 'compra_cheia'
  reuniao_em            timestamptz,          -- reunião comercial (data + hora)
  reuniao_resultado     text,
  entrevista_em         timestamptz,          -- entrevista de ativação (data + hora)
  entrevista_resultado  text,
  pagamento_forma       text,                 -- 'avista' | 'parcelado'
  pagamento_parcelas    integer,
  pagamento_em          timestamptz,
  apto_ativacao         boolean not null default false,
  tags                  text[] not null default '{}',
  observacoes           text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists cs_contatos_hm_estagio_idx on cs.contatos_hm (estagio_id);
create index if not exists cs_contatos_hm_reuniao_idx on cs.contatos_hm (reuniao_em) where reuniao_em is not null;
create index if not exists cs_contatos_hm_entrevista_idx on cs.contatos_hm (entrevista_em) where entrevista_em is not null;

grant select, insert, update, delete on cs.contatos_hm to disparos_app;
alter table cs.contatos_hm enable row level security;
drop policy if exists app_all on cs.contatos_hm;
create policy app_all on cs.contatos_hm to disparos_app using (true) with check (true);

-- 6) Timeline reaproveitada: cs.interacoes aceita referência ao overlay HM ---
alter table cs.interacoes add column if not exists contato_hm_id uuid references cs.contatos_hm(id) on delete cascade;
alter table cs.interacoes alter column contato_id drop not null;
do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'interacoes_alvo_unico') then
    alter table cs.interacoes
      add constraint interacoes_alvo_unico check (num_nonnulls(contato_id, contato_hm_id) = 1);
  end if;
end$chk$;
create index if not exists cs_interacoes_contato_hm_idx on cs.interacoes (contato_hm_id) where contato_hm_id is not null;

-- 7) Formulários: aceita tipos do HM (Respondi) além dos do HT ---------------
alter table cs.formularios drop constraint if exists formularios_tipo_check;
alter table cs.formularios
  add constraint formularios_tipo_check
  check (tipo in ('matricula','ficha_hm') or tipo like 'hm_%');

-- 8) Seed do HM: trigger em public.compras + função ------------------------
-- Entrada (sinal/compra_cheia) cria o card em hm_comprou com o plano da oferta.
-- Diferença (saldo 14.700) → registra pagamento e joga pra Ativação (apto).
create or replace function cs.fn_seed_contato_hm()
returns trigger language plpgsql security definer set search_path = cs, public
as $fn$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_pago  smallint;
  v_entr  smallint;
  v_id    uuid;
  v_estagio_atual smallint;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  select cat.categoria, cat.notes into v_cat, v_notes
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if v_cat is null then
    return new; -- oferta não é do HM (ou não catalogada)
  end if;

  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_pago from cs.estagios where evento='HM' and chave='hm_pagamento_realizado' limit 1;
  select id into v_entr from cs.estagios where evento='HM' and chave='hm_entrevista_agendada' limit 1;

  -- ENTRADA no kanban: sinal + compra cheia
  if v_cat in ('sinal','compra_cheia') then
    insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
    values (new.comprador_id, v_ini, 'T39', v_notes, v_cat)
    on conflict (comprador_id) do update
      set plano = coalesce(cs.contatos_hm.plano, excluded.plano),
          categoria_entrada = coalesce(cs.contatos_hm.categoria_entrada, excluded.categoria_entrada),
          atualizado_em = now();

    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema', 'Entrou na esteira HM ('||v_cat||' — '||coalesce(v_notes,'oferta')||')', 'sistema');
    end if;
    return new;
  end if;

  -- DIFERENÇA (saldo 14.700): registra pagamento e move pra Ativação.
  -- Só age se o comprador já é um card HM (respeita "só sinal/cheia entram").
  if v_cat = 'diferenca' then
    select id, estagio_id into v_id, v_estagio_atual from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_entr,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_entr;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — apto para ativação', 'sistema');
      end if;
    end if;
    return new;
  end if;

  return new;
end$fn$;

drop trigger if exists trg_seed_contato_hm on public.compras;
create trigger trg_seed_contato_hm after insert on public.compras
  for each row execute function cs.fn_seed_contato_hm();

-- 9) Backfill dos compradores HM já existentes (sinal/compra_cheia) ----------
insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
select distinct on (cmp.comprador_id)
       cmp.comprador_id,
       (select id from cs.estagios where evento='HM' and chave='hm_comprou' limit 1),
       'T39',
       cat.notes,
       cat.categoria
  from public.compras cmp
  join public.hm_product_catalog cat on cat.offer_code = cmp.oferta_codigo
 where cmp.status in ('APPROVED','COMPLETE','COMPLETED')
   and cat.categoria in ('sinal','compra_cheia')
 order by cmp.comprador_id, cmp.data_aprovacao desc nulls last
on conflict (comprador_id) do nothing;

insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select ch.id, 'sistema', 'Importado para a esteira HM (backfill inicial)', 'sistema'
  from cs.contatos_hm ch
 where not exists (
   select 1 from cs.interacoes i where i.contato_hm_id = ch.id and i.tipo='sistema'
 );

-- Backfill da DIFERENÇA já paga (saldo 14.700) → Ativação (apto).
update cs.contatos_hm ch
   set pagamento_em = coalesce(ch.pagamento_em, d.data_aprovacao, now()),
       estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_entrevista_agendada' limit 1),
       apto_ativacao = true,
       atualizado_em = now()
  from (
    select distinct on (cmp.comprador_id) cmp.comprador_id, cmp.data_aprovacao
      from public.compras cmp
      join public.hm_product_catalog cat on cat.offer_code = cmp.oferta_codigo
     where cmp.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria = 'diferenca'
     order by cmp.comprador_id, cmp.data_aprovacao desc nulls last
  ) d
 where d.comprador_id = ch.comprador_id
   and coalesce(ch.estagio_id, -1) <> (select id from cs.estagios where evento='HM' and chave='hm_entrevista_agendada' limit 1)
   and ch.estagio_id in (select id from cs.estagios where evento='HM' and aba='comercial');

-- 10) View de leitura do kanban/ficha HM ------------------------------------
-- Junta o overlay com o comprador e o estágio. Espelha o que as telas HM leem.
drop view if exists cs.contatos_hm_kanban;
create view cs.contatos_hm_kanban with (security_invoker = false) as
select
  ch.id            as contato_hm_id,
  ch.comprador_id,
  cmp.nome, cmp.email, cmp.telefone,
  ch.turma, ch.plano, ch.categoria_entrada,
  ch.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, est.aba as estagio_aba,
  ch.responsavel, ch.reuniao_em, ch.reuniao_resultado,
  ch.entrevista_em, ch.entrevista_resultado,
  ch.pagamento_forma, ch.pagamento_parcelas, ch.pagamento_em,
  ch.apto_ativacao, ch.tags, ch.observacoes,
  ch.criado_em, ch.atualizado_em
from cs.contatos_hm ch
join public.compradores cmp on cmp.id = ch.comprador_id
left join cs.estagios est on est.id = ch.estagio_id;

grant select on cs.contatos_hm_kanban to disparos_app;
