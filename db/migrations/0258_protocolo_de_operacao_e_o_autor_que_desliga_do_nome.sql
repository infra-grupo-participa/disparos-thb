-- 0258_protocolo_de_operacao_e_o_autor_que_desliga_do_nome.sql
--
-- Duas coisas represadas atrás da mesma trava: `cs.interacoes` proíbe registrar ação que
-- NÃO tem uma pessoa como alvo (`interacoes_alvo_unico`, 0028) — então nada do que não tem
-- alvo-pessoa é registrado hoje: emitir relatório, importar planilha, ativar/desativar
-- oferta, mudar equipe, exportar XLSX. É o "protocolar os processos, burocratizar, ter
-- tim-tim por tim-tim mapeado" que o João pediu em 16/08 — sem virar ficha de pessoa.
--
-- E o relatório "ações do comercial" (que o próprio João chamou de "papo de demissional",
-- diário 16/08 02:40) casa autor por TEXTO (cs.interacoes.autor = cs.usuarios.nome). Se um
-- nome casar com 2+ usuários, a ação de uma pessoa vai para a conta de outra. `autor_id`
-- fecha essa porta: FK estável que não se desliga quando alguém muda de nome.
--
-- CONTAR ANTES — rodado em produção pelo Orquestrador em 16/08/2026 (medição real, não
-- estimativa): cs.interacoes tem 6.094 linhas (a mais antiga de 08/06/2026), nenhuma com
-- autor nulo ou vazio; 20 autores distintos; 0 nomes duplicados em cs.usuarios. O BLOQUEIO
-- do arquiteto ("se algum autor casar com 2+ usuários, pare e escale") NÃO se confirmou —
-- não há homônimo hoje. Ainda assim o backfill abaixo é escrito para ser seguro por
-- CONSTRUÇÃO, não por essa medição de um dia: só recebe autor_id quem casa com EXATAMENTE
-- um usuário. Se um homônimo aparecer no futuro, ele nasce com autor_id NULL — nunca
-- credita a ação de uma pessoa a outra.

-- 1) o helper único de burocracia: um protocolo por ação sem pessoa como alvo.
create table if not exists cs.protocolo_operacao (
  id          bigserial primary key,
  acao        text not null,        -- 'relatorio.emitir' · 'oferta.importar' · 'oferta.ativar' · ...
  alvo_tipo   text,                 -- 'oferta' · 'import' · 'equipe' · 'relatorio'
  alvo_id     text,
  detalhe     jsonb not null default '{}'::jsonb,
  autor       text not null,
  autor_id    uuid references cs.usuarios(id) on delete set null,
  portal      text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_protocolo_acao on cs.protocolo_operacao (acao, criado_em desc);

-- APPEND-ONLY (lição da 0177): a 0001 dá `alter default privileges` com insert/update/delete
-- a disparos_app em TODA tabela nova do schema cs. Sem este revoke, o protocolo vira
-- reescrevível e deixa de provar qualquer coisa — a razão de ele existir.
revoke update, delete on cs.protocolo_operacao from disparos_app;
grant  select, insert on cs.protocolo_operacao to disparos_app;

-- 2) cs.interacoes ganha autor_id — desliga o histórico do TEXTO do nome.
alter table cs.interacoes add column if not exists autor_id uuid references cs.usuarios(id) on delete set null;
create index if not exists cs_interacoes_autor_id_idx on cs.interacoes (autor_id) where autor_id is not null;

-- 3) Backfill seguro por construção: só ganha autor_id quem casa com EXATAMENTE 1 usuário
-- pelo nome. Homônimo (2+ usuários com o mesmo nome) e "sem usuário nenhum" (sistema, make,
-- hotmart, lead, cs, respondi — ver ATORES_SISTEMA em lib/services/hm-atividade.ts) ficam
-- NULL, de propósito: não é omissão, é a garantia de nunca creditar a ação de uma pessoa a
-- outra. Idempotente: só toca linha com autor_id ainda NULL.
do $$
declare v_atualizadas int;
begin
  update cs.interacoes i
     set autor_id = u.id
    from (
      -- (array_agg(id))[1] e nao min(id): o Postgres nao tem min(uuid).
      -- O `having count(*) = 1` ja garante que existe exatamente um id aqui.
      select nome, (array_agg(id))[1] as id
        from cs.usuarios
       group by nome
      having count(*) = 1
    ) u
   where i.autor = u.nome
     and i.autor_id is null;
  get diagnostics v_atualizadas = row_count;
  raise notice '0258: autor_id preenchido em % interacoes (nomes com casamento unico).', v_atualizadas;
end $$;

-- Conferência: quantas linhas de autor humano (fora da lista de sistema) seguem sem
-- autor_id — hoje deveria ser 0, dado que a medição de 16/08 achou zero homônimo e todo
-- autor humano casa com um usuário existente. Só relata; não bloqueia a migration.
do $$
declare v_sem_id int;
begin
  select count(*) into v_sem_id
    from cs.interacoes i
   where i.autor_id is null
     and i.autor is not null
     and lower(btrim(i.autor)) not in ('sistema','make','hotmart','lead','cs','respondi')
     and i.autor not ilike 'migration%';
  raise notice '0258: % interacoes de autor humano seguem sem autor_id (homonimo, ou autor fora de cs.usuarios) — o relatorio mostra "autor a confirmar" para essas.', v_sem_id;
end $$;

-- Volta: drop table cs.protocolo_operacao; alter table cs.interacoes drop column autor_id;
