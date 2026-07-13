-- =====================================================================
-- 0064_hm_agendamentos
-- O reagendamento existe na operação e não existia no sistema.
--
-- Hoje o card guarda UMA data de reunião e UMA de entrevista (contatos_hm.
-- reuniao_em / entrevista_em). Remarcar sobrescreve: a data anterior some, e com
-- ela o fato de que a pessoa já tinha marcado e não veio. Ninguém consegue
-- responder "quantas vezes esse aluno remarcou?" — que é exatamente a pergunta
-- que separa o lead morno do lead que está enrolando.
--
-- Esta tabela é o histórico: uma linha por marcação. A data vigente continua no
-- card (é o que a agenda e o kanban leem); aqui fica a trilha — quando foi
-- marcada, para quando, quem marcou, e por que a anterior caiu.
--
-- status:
--   agendado       → a marcação vigente
--   reagendado     → foi substituída por outra data (o motivo diz por quê)
--   realizado      → aconteceu
--   nao_compareceu → o aluno não veio (no-show)
--   cancelado      → desmarcada sem nova data
--
-- Aditiva e idempotente.
-- =====================================================================

create table if not exists cs.hm_agendamentos (
  id             uuid primary key default gen_random_uuid(),
  contato_hm_id  uuid not null references cs.contatos_hm(id) on delete cascade,
  tipo           text not null check (tipo in ('reuniao', 'entrevista')),
  quando         timestamptz not null,
  status         text not null default 'agendado'
                 check (status in ('agendado', 'reagendado', 'realizado', 'nao_compareceu', 'cancelado')),
  motivo         text,              -- por que a marcação anterior caiu
  autor          text,
  criado_em      timestamptz not null default now(),
  encerrado_em   timestamptz        -- quando deixou de ser a marcação vigente
);

create index if not exists idx_hm_agendamentos_contato on cs.hm_agendamentos (contato_hm_id, tipo, criado_em desc);
create index if not exists idx_hm_agendamentos_vigente on cs.hm_agendamentos (contato_hm_id, tipo) where status = 'agendado';

grant select, insert, update, delete on cs.hm_agendamentos to disparos_app;

-- Backfill: as datas que já estão nos cards viram a primeira marcação de cada um.
-- Sem isso, o primeiro reagendamento pareceria o primeiro agendamento — e a conta
-- de remarcações começaria errada.
insert into cs.hm_agendamentos (contato_hm_id, tipo, quando, status, autor, criado_em)
select ch.id, 'reuniao', ch.reuniao_em, 'agendado', 'sistema', coalesce(ch.atualizado_em, now())
  from cs.contatos_hm ch
 where ch.reuniao_em is not null
   and not exists (select 1 from cs.hm_agendamentos a where a.contato_hm_id = ch.id and a.tipo = 'reuniao');

insert into cs.hm_agendamentos (contato_hm_id, tipo, quando, status, autor, criado_em)
select ch.id, 'entrevista', ch.entrevista_em, 'agendado', 'sistema', coalesce(ch.atualizado_em, now())
  from cs.contatos_hm ch
 where ch.entrevista_em is not null
   and not exists (select 1 from cs.hm_agendamentos a where a.contato_hm_id = ch.id and a.tipo = 'entrevista');

-- Quantas vezes cada card já remarcou — o número que o operador quer ver no card.
create or replace view cs.hm_reagendamentos as
select ch.comprador_id,
       count(*) filter (where a.tipo = 'reuniao'    and a.status = 'reagendado') as reunioes_remarcadas,
       count(*) filter (where a.tipo = 'entrevista' and a.status = 'reagendado') as entrevistas_remarcadas,
       count(*) filter (where a.status = 'nao_compareceu')                       as nao_comparecimentos
  from cs.contatos_hm ch
  left join cs.hm_agendamentos a on a.contato_hm_id = ch.id
 group by ch.comprador_id;

grant select on cs.hm_reagendamentos to disparos_app;
