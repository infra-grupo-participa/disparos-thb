-- =====================================================================
-- 0008_cs_normalizar_telefone
-- Função de normalização de telefone BR (55DDDNÚMERO), igual ao normalizePhone
-- de lib/phone.ts. Necessária no sync de conversas: telefones vindos dos CSVs
-- importados estão sem o prefixo 55, e a busca na Unnichat exige o formato cheio.
-- =====================================================================
create or replace function cs.normalizar_telefone(raw text)
returns text language sql immutable as $$
  select case
    when d = '' then null
    when left(d, 2) <> '55' and length(d) in (10, 11) then '55' || d
    else d
  end
  from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d) t
$$;

grant execute on function cs.normalizar_telefone(text) to disparos_app;
