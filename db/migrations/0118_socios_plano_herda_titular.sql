-- =====================================================================
-- 0118_socios_plano_herda_titular
--
-- BUG na 0057: fn_hm_provisionar_socios inseria plano='socio' em thb_alunos, mas
-- thb_alunos_plano_check só aceita aluno/diamante/platina/super_diamante/aurum.
-- Todo provisionamento de sócio quebrava na constraint — e como a chamada é
-- blindada por try/catch no app, o erro era engolido: os sócios NUNCA entravam na
-- base (0 de 8 estavam lá). Era a raiz do "o aluno pagou e quer acesso".
--
-- Correção: o sócio ACOMPANHA o titular — herda o `plano` dele (fallback 'aluno').
-- Que é sócio já fica registrado em eh_socio/origem_acesso/fonte/regra_acesso, não
-- no plano. Só muda a origem do plano no insert; o resto da função é igual à 0057.
-- Idempotente.
-- =====================================================================

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
  select ch.id as card_id, ch.aluno_id, a.turma_id, a.plano, a.data_expiracao, a.data_compra
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
        s.nome, nullif(trim(s.email), ''), s.telefone, coalesce(v_titular.plano, 'aluno'), v_titular.turma_id, true, v_titular.aluno_id,
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

  update public.thb_alunos set num_socios = n, atualizado_em = now()
   where id = v_titular.aluno_id and coalesce(num_socios, 0) is distinct from n;

  return n;
end$fn$;

grant execute on function cs.fn_hm_provisionar_socios(uuid) to disparos_app;
