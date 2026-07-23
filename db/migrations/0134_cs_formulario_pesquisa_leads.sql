-- =====================================================================
-- 0134_cs_formulario_pesquisa_leads
-- Materializa as respostas de pesquisa dos leads (SEM/CNHF) como FORMULÁRIO
-- estruturado — igual aos formulários do Respondi no HT (aba "Formulários" do
-- card). Antes esses dados viviam só em observacoes (texto).
--
-- Tipo novo 'pesquisa' (não 'matricula') de propósito: a view cs.lead_scores
-- calcula o termômetro do HT com max(pontuacao) por tipo — reusar 'matricula'
-- com o health_score (0-100) do CNHF distorceria o score dos HT. 'pesquisa' fica
-- fora desse cálculo.
--
-- Fontes em tempo real do CNHF: as respostas ricas moram em
-- workbook.respostas_pesquisa (answers jsonb + health_score). Dois gatilhos
-- mantêm o formulário em dia: um no controle.lead (entrada do lead) e um no
-- próprio workbook (quando a pessoa responde/atualiza a pesquisa).
-- =====================================================================

-- 1) Libera o tipo 'pesquisa' na tabela de formulários.
alter table cs.formularios drop constraint if exists formularios_tipo_check;
alter table cs.formularios add constraint formularios_tipo_check
  check (tipo in ('matricula','ficha_hm','pesquisa'));

-- 2) Upsert de formulário (1 por comprador+tipo).
create or replace function cs.fn_form_upsert(
  p_comprador uuid, p_tipo text, p_respostas jsonb,
  p_pontuacao numeric default null, p_respondido timestamptz default null
) returns void language sql security definer set search_path = cs, public as $$
  insert into cs.formularios (comprador_id, tipo, respostas, pontuacao, respondido_em)
  values (p_comprador, p_tipo, coalesce(p_respostas, '{}'::jsonb), p_pontuacao, p_respondido)
  on conflict (comprador_id, tipo) do update
    set respostas = excluded.respostas,
        pontuacao = coalesce(excluded.pontuacao, cs.formularios.pontuacao),
        respondido_em = coalesce(excluded.respondido_em, cs.formularios.respondido_em),
        atualizado_em = now();
$$;
grant execute on function cs.fn_form_upsert(uuid,text,jsonb,numeric,timestamptz) to disparos_app;

-- 3) Traduz as chaves técnicas da pesquisa do CNHF (workbook) para rótulos
-- legíveis, e descarta respostas em branco.
create or replace function cs.fn_cnhf_form_respostas(p_answers jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(coalesce(m.label, kv.key), kv.value), '{}'::jsonb)
  from jsonb_each_text(coalesce(p_answers, '{}'::jsonb)) kv
  left join (values
    ('area','Área de atuação'),
    ('area_outra','Área — qual'),
    ('atua_holding','Atua com Holding hoje?'),
    ('atua_tempo','Há quanto tempo atua'),
    ('faturamento','Faturamento mensal'),
    ('quantos_clientes','Clientes de Holding'),
    ('formacao_holding','Formação em Holding'),
    ('formacao_origem','Onde se formou'),
    ('formacao_como','Como se formou'),
    ('estudo_como','Como estudou'),
    ('objetivo','Objetivo com o Curso'),
    ('dificuldade','Maior dificuldade')
  ) m(key,label) on m.key = kv.key
  where btrim(coalesce(kv.value,'')) <> '';
$$;

-- 4) Sync do Curso: além de criar o card, popula o formulário de pesquisa
-- buscando as respostas ricas no workbook. (Reescreve a função de 0133.)
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
      case when new.is_mql then 'cnhf_mql' else 'cnhf_lead' end,
      'Curso Nacional de Formacao em Holding Familiar'
        || ' | Profissao: ' || coalesce(new.profissao::text, '-')
        || case when new.origem is not null then ' | Origem: ' || new.origem else '' end
        || case when new.entrou_grupo then ' | no grupo' else '' end
        || case when new.preencheu_pesquisa then ' | respondeu pesquisa' else '' end,
      array['CNHF']
    );
    -- formulário de pesquisa (respostas ricas do workbook)
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

-- 5) Quando a pessoa responde/atualiza a pesquisa no workbook, reflete no
-- formulário do card (se já existir comprador).
create or replace function workbook.fn_sync_pesquisa_cnhf() returns trigger
language plpgsql security definer set search_path = workbook, cs, public as $$
declare v_comprador uuid;
begin
  begin
    select id into v_comprador from public.compradores
      where lower(btrim(email)) = lower(btrim(new.email)) limit 1;
    if v_comprador is not null and new.answers is not null and new.answers <> '{}'::jsonb then
      perform cs.fn_form_upsert(v_comprador, 'pesquisa', cs.fn_cnhf_form_respostas(new.answers), new.health_score, new.criado_em);
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_sync_pesquisa_cnhf on workbook.respostas_pesquisa;
create trigger trg_sync_pesquisa_cnhf
  after insert or update on workbook.respostas_pesquisa
  for each row execute function workbook.fn_sync_pesquisa_cnhf();
