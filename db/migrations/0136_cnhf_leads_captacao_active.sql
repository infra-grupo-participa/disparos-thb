-- =====================================================================
-- 0136_cnhf_leads_captacao_active
-- O Curso tem DUAS camadas de público no dashboard, e o kanban precisa das duas:
--   - controle.lead_active  = captação bruta (ActiveCampaign/Meta Ads) = LEADS
--   - controle.lead          = quem respondeu a pesquisa               = MQLs
-- Antes só puxávamos controle.lead (os MQLs). Este gatilho traz também os leads
-- de captação para a coluna "Leads"; quando o lead responde a pesquisa, os
-- gatilhos de 0135 o promovem para MQL. Profissão (segmento) vira tag; origem e
-- UTM da campanha vão para as observações.
-- =====================================================================

create or replace function controle.fn_sync_lead_active_cnhf() returns trigger
language plpgsql security definer set search_path = controle, cs, public as $$
declare
  v_slug text;
  v_respondeu boolean;
begin
  begin
    select slug into v_slug from controle.evento where id = new.evento_id;
    if v_slug is distinct from 'lancamento-parceria-ago-2026' then return new; end if;
    if new.email is null or btrim(new.email) = '' then return new; end if;
    select exists(
      select 1 from controle.lead l where lower(btrim(l.external_id)) = lower(btrim(new.email))
    ) into v_respondeu;
    perform cs.fn_lead_upsert(
      'CNHF', new.nome, new.email, new.telefone,
      case when v_respondeu then 'cnhf_mql' else 'cnhf_lead' end,
      'Captacao (Meta/ActiveCampaign)'
        || case when new.segmento is not null then ' | Segmento: ' || new.segmento else '' end
        || case when new.origem is not null then ' | Origem: ' || new.origem else '' end
        || case when new.utm_source is not null then ' | UTM: ' || new.utm_source else '' end
        || case when new.utm_campaign is not null then ' | Campanha: ' || new.utm_campaign else '' end,
      array['CNHF'] || case when new.segmento is not null and btrim(new.segmento) <> ''
                            then array[initcap(new.segmento)] else '{}'::text[] end
    );
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_sync_lead_active_cnhf on controle.lead_active;
create trigger trg_sync_lead_active_cnhf
  after insert or update on controle.lead_active
  for each row execute function controle.fn_sync_lead_active_cnhf();
