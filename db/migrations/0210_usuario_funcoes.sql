-- 0210 — "equipe de ativação" (0202, coluna boolean por pessoa) vira FUNÇÃO por
-- PORTAL: `cs.usuario_funcoes`. Continua sendo "capacidade de PESSOA" — mesmo
-- espírito da 0145/0154/0202 — mas agora modelada como par (portal, função) em
-- vez de um boolean único amarrado ao HM.
--
-- ── POR QUE TROCAR O BOOLEAN POR TABELA (decisão do Marcio, 12/08 16h) ─────────
-- A 0202 deu `equipe_ativacao boolean` só para "vê todo card da aba Ativação do
-- HM". O caso Gabriela (12/08) trouxe a necessidade de registrar TAMBÉM quem tem
-- a função COMERCIAL — e o mesmo dono pode ter as duas. Um boolean não modela
-- duas funções independentes por pessoa; uma tabela de vínculo modela.
--
-- ── DECISÃO 1 DO MARCIO: Ana Camila e Thomas ficam com as DUAS funções ─────────
-- Preserva o comportamento de hoje: eles já enxergam a aba Ativação inteira
-- (0202) — aqui ganham TAMBÉM 'comercial' no HM, para não perder alcance no
-- deploy desta migration. Não é um julgamento novo sobre o papel dos dois; é
-- "não regredir o que já funciona" enquanto a função vira granular por card
-- (ver 0211).
--
-- `cs.usuarios.equipe_ativacao` (0202) NÃO é dropada aqui — fica órfã de
-- propósito por um deploy, para rollback seguro caso a leitura nova falhe em
-- produção. O drop é migration futura, depois de confirmar que nenhum código
-- lê mais a coluna.
--
-- Mesmo padrão de GRANT/RLS de cs.usuario_portais (0145): schema `cs` não usa
-- RLS por linha de negócio (autorização por escopo vive em
-- lib/services/visibilidade.ts) — a policy aqui é o "using(true)" padrão desta
-- tabela de vínculo, não uma trava por usuário autenticado. GRANT explícito
-- porque service_role não dispensa policy nem grant neste projeto.

create table if not exists cs.usuario_funcoes (
  usuario_id uuid not null references cs.usuarios(id) on delete cascade,
  portal     text not null check (portal = any (array['HT','SEM','CNHF','HM','AURUM','ETHB'])),
  funcao     text not null check (funcao in ('comercial','ativacao')),
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, portal, funcao)
);

comment on table cs.usuario_funcoes is
  '0210: função (comercial/ativação) que uma PESSOA exerce em um PORTAL. Uma pessoa pode ter as duas funções no mesmo portal (ex.: Ana Camila e Thomas no HM). Não dá posse de card nem permissão de disparo — só marca a função, quem lê decide o alcance (ver cs.contatos_hm_kanban / cs.vw_equipe_ativacao).';

-- Leitura por usuário: a sessão carrega isto a CADA request (todas as funções
-- da pessoa logada, em qualquer portal) — sem este índice cai em seq scan a
-- cada login/refresh. A PK já cobre (usuario_id, portal, funcao) da esquerda
-- para a direita, então já atende "todas as funções do usuário X" sozinha;
-- índice extra não muda plano nenhum e só duplicaria a PK — não criado.

grant select, insert, update, delete on cs.usuario_funcoes to disparos_app;
alter table cs.usuario_funcoes enable row level security;
drop policy if exists app_all on cs.usuario_funcoes;
create policy app_all on cs.usuario_funcoes to disparos_app using (true) with check (true);

-- ── Backfill: Ana Camila e Thomas → HM/comercial E HM/ativacao ─────────────────
-- Por e-mail via `equipe_ativacao` (0202), não por uuid hardcoded — id de
-- usuário não é estável entre ambientes, e a regra fica auditável ("quem tem
-- equipe_ativacao=true entra aqui" continua verdade até a coluna ser dropada).
insert into cs.usuario_funcoes (usuario_id, portal, funcao)
select u.id, 'HM', f.funcao
  from cs.usuarios u
  cross join (values ('comercial'), ('ativacao')) as f(funcao)
 where u.equipe_ativacao
on conflict do nothing;

-- ── View explicativa: agora lê a tabela nova, não o boolean ────────────────────
-- Mesmo contrato de saída da 0202 (usuario_id, nome, email, papel, equipe,
-- equipe_tipo, equipe_ativacao, cards_alcancados) — quem já consulta esta view
-- não quebra. `equipe_ativacao` no retorno passa a significar "tem a função
-- ativacao no portal HM", derivado da tabela nova.
create or replace view cs.vw_equipe_ativacao as
  select u.id as usuario_id, u.nome, u.email, u.papel,
         e.nome as equipe, e.tipo as equipe_tipo,
         true as equipe_ativacao,
         (select count(*) from cs.contatos_hm_kanban k
           where k.produto = 'HM' and k.estagio_aba = 'ativacao') as cards_alcancados
    from cs.usuarios u
    join cs.usuario_funcoes uf on uf.usuario_id = u.id and uf.portal = 'HM' and uf.funcao = 'ativacao'
    left join cs.equipes e on e.id = u.equipe_id
   where u.ativo;

comment on view cs.vw_equipe_ativacao is
  '0210: quem tem a funcao ativacao no portal HM (cs.usuario_funcoes) e quantos cards da aba Ativacao a regra alcanca. Substitui a leitura do boolean cs.usuarios.equipe_ativacao (0202) — coluna preservada como orfa para rollback, drop e migration futura.';

grant select on cs.vw_equipe_ativacao to disparos_app;

-- ── Conferência ──────────────────────────────────────────────────────────────
do $$
declare
  v_total int;
  v_ana_thomas int;
  v_fora_portal int;
  v_view_count int;
begin
  select count(*) into v_total from cs.usuario_funcoes;
  if v_total < 4 then
    raise exception '0210: esperado pelo menos 4 vinculos (Ana Camila + Thomas x comercial/ativacao), achou %', v_total;
  end if;

  select count(*) into v_ana_thomas
    from cs.usuario_funcoes f
    join cs.usuarios u on u.id = f.usuario_id
   where lower(u.email) in ('anacamila@advmais.com','thomas@advmais.com')
     and f.portal = 'HM';
  if v_ana_thomas <> 4 then
    raise exception '0210: Ana Camila e Thomas deveriam ter 4 vinculos HM (2 pessoas x 2 funcoes), achou %', v_ana_thomas;
  end if;

  -- Ninguém pode ter função num portal que não possui (cs.usuario_portais).
  select count(*) into v_fora_portal
    from cs.usuario_funcoes f
   where not exists (
     select 1 from cs.usuario_portais p
      where p.usuario_id = f.usuario_id and p.portal = f.portal);
  if v_fora_portal > 0 then
    raise exception '0210: % vinculo(s) em cs.usuario_funcoes apontam para portal que a pessoa nao possui em cs.usuario_portais', v_fora_portal;
  end if;

  select count(*) into v_view_count from cs.vw_equipe_ativacao;
  if v_view_count <> 2 then
    raise exception '0210: cs.vw_equipe_ativacao deveria trazer 2 pessoas (Ana Camila, Thomas), trouxe %', v_view_count;
  end if;

  raise notice '0210: cs.usuario_funcoes com % vinculo(s), vw_equipe_ativacao com % pessoa(s).', v_total, v_view_count;
end $$;
