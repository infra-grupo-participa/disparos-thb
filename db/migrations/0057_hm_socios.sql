-- =====================================================================
-- 0057_hm_socios
-- O sócio convidado — a aba "SÓCIOS T39" da planilha.
--
-- Sócio NÃO é um campo do card ("Convidou sócio? SIM/NÃO"): na planilha ele tem
-- nome, e-mail, telefone E CHECKLIST PRÓPRIO (Searchie/Óbvio, comunidade THB,
-- grupo de informes, link do Facebook). Ou seja, ele também é ativado — só que
-- pendurado no titular. Por isso vira tabela, não coluna.
--
-- Na base mestre isso já existe e é como o GPS enxerga: thb_alunos.eh_socio +
-- socio_de_aluno_id + num_socios (462 sócios hoje). Quando o TITULAR quita e
-- vira aluno, os sócios dele são provisionados na mesma turma, vinculados a ele.
-- Antes disso o sócio é só um convidado: fica no overlay do HM, sem tocar a base.
--
-- `convidou_socio` não vira campo: é `exists (sócio)` — um booleano paralelo à
-- tabela só criaria duas verdades para a mesma pergunta.
-- Aditiva e idempotente.
-- =====================================================================

create table if not exists cs.hm_socios (
  id              uuid primary key default gen_random_uuid(),
  contato_hm_id   uuid not null references cs.contatos_hm(id) on delete cascade,
  nome            text not null,
  email           text,
  telefone        text,
  -- checklist do sócio (o mesmo do titular, menos a pesquisa — que a planilha
  -- não pede para o sócio)
  ativ_searchie   boolean not null default false,
  ativ_comunidade boolean not null default false,
  ativ_grupo      boolean not null default false,
  link_facebook   text,
  aluno_id        uuid references public.thb_alunos(id) on delete set null,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- O mesmo sócio não entra duas vezes no mesmo titular.
create unique index if not exists hm_socios_contato_email_uidx
  on cs.hm_socios (contato_hm_id, lower(trim(email))) where email is not null and email <> '';

create index if not exists hm_socios_contato_idx on cs.hm_socios (contato_hm_id);

grant select, insert, update, delete on cs.hm_socios to disparos_app;

-- O link do Facebook do TITULAR também é da planilha, e o card precisa de onde
-- guardá-lo antes de a pessoa virar aluno (a base só recebe quem quitou).
alter table cs.contatos_hm add column if not exists link_facebook text;

-- Provisiona os sócios do titular na base mestre --------------------------
-- Só roda depois que o titular virou aluno: sócio acompanha o titular (mesma
-- turma, mesma validade) e é isso que `socio_de_aluno_id` significa. Enquanto o
-- titular não quita, o sócio não existe para o GPS.
create or replace function cs.fn_hm_provisionar_socios(p_comprador_id uuid)
returns integer
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_titular   record;
  s           record;
  v_socio_id  uuid;
  n           integer := 0;
begin
  select ch.id as card_id, ch.aluno_id, a.turma_id, a.data_expiracao, a.data_compra
    into v_titular
    from cs.contatos_hm ch
    join public.thb_alunos a on a.id = ch.aluno_id
   where ch.comprador_id = p_comprador_id;
  if not found then return 0; end if;   -- titular ainda não é aluno

  for s in select * from cs.hm_socios where contato_hm_id = v_titular.card_id loop
    v_socio_id := s.aluno_id;

    if v_socio_id is null and coalesce(trim(s.email), '') <> '' then
      select id into v_socio_id from public.thb_alunos
       where lower(trim(email)) = lower(trim(s.email)) limit 1;
    end if;

    if v_socio_id is null then
      insert into public.thb_alunos (
        nome, email, telefone, plano, turma_id, eh_socio, socio_de_aluno_id,
        data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
        situacao_financeira, link_facebook, fonte
      ) values (
        s.nome, nullif(trim(s.email), ''), s.telefone, 'socio', v_titular.turma_id, true, v_titular.aluno_id,
        v_titular.data_compra, v_titular.data_expiracao, 'Sócio (HM)', 'Acompanha o titular', '1 ano',
        'acompanha_titular', s.link_facebook, 'sip_ativacao_hm'
      )
      returning id into v_socio_id;
    else
      update public.thb_alunos set
        eh_socio          = true,
        socio_de_aluno_id = v_titular.aluno_id,
        turma_id          = v_titular.turma_id,
        data_expiracao    = v_titular.data_expiracao,
        link_facebook     = coalesce(link_facebook, s.link_facebook),
        atualizado_em     = now()
      where id = v_socio_id;
    end if;

    update cs.hm_socios set aluno_id = v_socio_id, atualizado_em = now() where id = s.id;
    n := n + 1;
  end loop;

  -- num_socios é o que a base usa para contar (e o que a planilha checava à mão).
  update public.thb_alunos set num_socios = n, atualizado_em = now()
   where id = v_titular.aluno_id and coalesce(num_socios, 0) is distinct from n;

  return n;
end$fn$;

grant execute on function cs.fn_hm_provisionar_socios(uuid) to disparos_app;
