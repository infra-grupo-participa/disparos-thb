-- =====================================================================
-- 0135_cnhf_mql_por_pesquisa_e_profissao
-- Régua de MQL do Curso (definida pelo Marcio): quem RESPONDEU a pesquisa de
-- qualificação é MQL (tem profissão advogado/contador/outro no dashboard). Quem
-- entra sem responder fica em Leads. A profissão vira TAG no card, para
-- diferenciar advogado/contador/outro direto no kanban.
--
-- Antes o estágio de entrada usava is_mql (que o dashboard nunca preenche) — por
-- isso todo mundo caía em Leads. Agora usa preencheu_pesquisa.
-- =====================================================================

-- Entrada do lead (controle.lead): estágio por pesquisa + tag da profissão.
create or replace function controle.fn_sync_lead_cnhf() returns trigger
language plpgsql security definer set search_path = controle, cs, public, workbook as $$
declare
  v_slug text;
  v_comprador uuid;
  v_answers jsonb;
  v_score int;
  v_resp timestamptz;
begin
  begin
    select slug into v_slug from controle.evento where id = new.evento_id;
    if v_slug is distinct from 'lancamento-parceria-ago-2026' then
      return new;
    end if;
    perform cs.fn_lead_upsert(
      'CNHF', new.nome, new.external_id, new.telefone,
      case when new.is_mql or new.preencheu_pesquisa then 'cnhf_mql' else 'cnhf_lead' end,
      'Curso Nacional de Formacao em Holding Familiar'
        || ' | Profissao: ' || coalesce(new.profissao::text, '-')
        || case when new.origem is not null then ' | Origem: ' || new.origem else '' end
        || case when new.entrou_grupo then ' | no grupo' else '' end
        || case when new.preencheu_pesquisa then ' | respondeu pesquisa' else '' end,
      array['CNHF'] || case when new.profissao is not null then array[initcap(new.profissao::text)] else '{}'::text[] end
    );
    select id into v_comprador from public.compradores
      where lower(btrim(email)) = lower(btrim(new.external_id)) limit 1;
    if v_comprador is not null then
      select answers, health_score, criado_em into v_answers, v_score, v_resp
        from workbook.respostas_pesquisa
        where lower(btrim(email)) = lower(btrim(new.external_id)) limit 1;
      if v_answers is not null and v_answers <> '{}'::jsonb then
        perform cs.fn_form_upsert(v_comprador, 'pesquisa', cs.fn_cnhf_form_respostas(v_answers), v_score, v_resp);
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

-- Ao responder a pesquisa (workbook): grava o formulário E promove o card de
-- Leads → MQL (só se ainda estiver em Leads; não mexe em card já trabalhado).
create or replace function workbook.fn_sync_pesquisa_cnhf() returns trigger
language plpgsql security definer set search_path = workbook, cs, public as $$
declare v_comprador uuid;
begin
  begin
    select id into v_comprador from public.compradores
      where lower(btrim(email)) = lower(btrim(new.email)) limit 1;
    if v_comprador is not null and new.answers is not null and new.answers <> '{}'::jsonb then
      perform cs.fn_form_upsert(v_comprador, 'pesquisa', cs.fn_cnhf_form_respostas(new.answers), new.health_score, new.criado_em);
      update cs.contatos
         set estagio_id = (select id from cs.estagios where evento='CNHF' and chave='cnhf_mql'),
             atualizado_em = now()
       where comprador_id = v_comprador and evento = 'CNHF'
         and estagio_id = (select id from cs.estagios where evento='CNHF' and chave='cnhf_lead');
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
