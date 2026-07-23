-- =====================================================================
-- 0133_cs_lead_upsert_e_sync_cnhf
-- O "cano de entrada" de leads para portais genéricos (SEM, CNHF), que não
-- existia: até aqui só HT (trigger de compra) e HM (tabela própria) criavam
-- cards. Duas peças:
--   1. cs.fn_lead_upsert — insere/atualiza um lead num evento, casando a pessoa
--      por e-mail em public.compradores (cria se nova). Idempotente.
--   2. Sincronização em tempo real do Curso: um trigger em controle.lead (o
--      dashboard do CNHF) espelha cada lead da pesquisa no Kanban do CNHF.
--
-- Restrição herdada: cs.contatos.comprador_id é UNIQUE global (sem o evento) e
-- ~30 gatilhos de HT/HM dependem de "on conflict (comprador_id)". Não dá para
-- trocar a constraint sem reescrever tudo. Consequência: uma pessoa vive em UM
-- portal por vez. Quem já é contato de outro evento NÃO é sobrescrito — a função
-- devolve 'colidiu:<evento>' e o chamador registra, em vez de descartar em silêncio.
-- =====================================================================

-- 1) Upsert de lead genérico. Retorna: 'inserido' | 'existe' | 'colidiu:HT' |
-- 'ignorado:email' | 'ignorado:estagio'. Nunca mexe no estágio de um card que já
-- existe (respeita o trabalho do operador) — só completa buracos de dados.
create or replace function cs.fn_lead_upsert(
  p_evento        text,
  p_nome          text,
  p_email         text,
  p_telefone      text default null,
  p_estagio_chave text default null,
  p_observacoes   text default null,
  p_tags          text[] default '{}'
) returns text
language plpgsql security definer set search_path = cs, public as $$
declare
  v_email  text := lower(btrim(p_email));
  v_nome   text := coalesce(nullif(btrim(p_nome), ''), nullif(split_part(lower(btrim(p_email)),'@',1),''), 'Lead');
  v_tel    text := nullif(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), '');
  v_comprador uuid;
  v_estagio   smallint;
  v_evento_atual text;
begin
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    return 'ignorado:email';
  end if;

  -- Pessoa: casa por e-mail (mesma chave do webhook e do cadastro HM). Cria se nova.
  select id into v_comprador from public.compradores where lower(btrim(email)) = v_email limit 1;
  if v_comprador is null then
    insert into public.compradores (nome, email, telefone, is_manual)
    values (v_nome, v_email, v_tel, true)
    returning id into v_comprador;
  else
    update public.compradores
       set telefone = coalesce(telefone, v_tel), atualizado_em = now()
     where id = v_comprador;
  end if;

  -- Estágio: a chave pedida, senão o inicial (is_inicial) do evento.
  if p_estagio_chave is not null then
    select id into v_estagio from cs.estagios where evento = p_evento and chave = p_estagio_chave limit 1;
  end if;
  if v_estagio is null then
    select id into v_estagio from cs.estagios where evento = p_evento and is_inicial and ativo order by ordem limit 1;
  end if;
  if v_estagio is null then
    return 'ignorado:estagio';
  end if;

  -- Já é contato? (comprador_id é único no total, não por evento.)
  select evento into v_evento_atual from cs.contatos where comprador_id = v_comprador;
  if found then
    if v_evento_atual = p_evento then
      update cs.contatos
         set observacoes = coalesce(observacoes, p_observacoes),
             tags = (select array(select distinct unnest(tags || p_tags))),
             atualizado_em = now()
       where comprador_id = v_comprador;
      return 'existe';
    end if;
    return 'colidiu:' || v_evento_atual;
  end if;

  insert into cs.contatos (comprador_id, estagio_id, evento, observacoes, tags, primeiro_contato_em)
  values (v_comprador, v_estagio, p_evento, p_observacoes, coalesce(p_tags,'{}'), now());
  return 'inserido';
end $$;

grant execute on function cs.fn_lead_upsert(text,text,text,text,text,text,text[]) to disparos_app;

-- 2) Sync em tempo real do Curso (CNHF). O dashboard grava os leads da pesquisa
-- em controle.lead; este gatilho espelha cada um no Kanban do CNHF. external_id
-- é o e-mail. O estágio de ENTRADA reflete is_mql (MQL vs Leads); updates depois
-- não reposicionam o card. Só a edição ago/2026 (o único evento do dashboard hoje).
create or replace function controle.fn_sync_lead_cnhf() returns trigger
language plpgsql security definer set search_path = controle, cs, public as $$
declare
  v_slug text;
begin
  begin
    select slug into v_slug from controle.evento where id = new.evento_id;
    if v_slug is distinct from 'lancamento-parceria-ago-2026' then
      return new;
    end if;
    perform cs.fn_lead_upsert(
      'CNHF',
      new.nome,
      new.external_id,
      new.telefone,
      case when new.is_mql then 'cnhf_mql' else 'cnhf_lead' end,
      'Curso Nacional de Formação em Holding Familiar'
        || ' | Profissão: ' || coalesce(new.profissao::text, '—')
        || case when new.origem is not null then ' | Origem: ' || new.origem else '' end
        || case when new.entrou_grupo then ' | no grupo' else '' end
        || case when new.preencheu_pesquisa then ' | respondeu pesquisa' else '' end,
      array['CNHF']
    );
  exception when others then
    null; -- jamais quebrar a gravação do dashboard por causa do espelhamento
  end;
  return new;
end $$;

drop trigger if exists trg_sync_lead_cnhf on controle.lead;
create trigger trg_sync_lead_cnhf
  after insert or update on controle.lead
  for each row execute function controle.fn_sync_lead_cnhf();
