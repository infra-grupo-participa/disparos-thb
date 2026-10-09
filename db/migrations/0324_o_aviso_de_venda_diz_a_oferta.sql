-- 0324_o_aviso_de_venda_diz_a_oferta
--
-- A Edge Function hotmart-events-webhook passa a escrever no Slack o nome da OFERTA
-- vendida, não um rótulo fixo por produto (a 1ª venda da Clínica de Miami, oferta
-- sju5pawn no produto 5682989, saiu como "Clínica ... - Porto Alegre" em 09/10/2026).
--
-- O nome mora em fin.ofertas (catálogo sincronizado da Hotmart, PK oferta_codigo).
-- fin não é exposto no PostgREST e o service_role não tem SELECT nele: a função lê
-- por uma casca SECURITY DEFINER em public, fechada a PUBLIC/anon/authenticated.
--
-- Custo: 1 Index Scan na PK por aviso de venda (dezenas por dia). Reversão:
-- drop function; a Edge Function trata erro do rpc como "sem nome" e volta ao
-- nome do produto.

create or replace function public.fn_hotmart_nome_oferta(p_oferta text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(o.nome), '') from fin.ofertas o where o.oferta_codigo = p_oferta
$$;

revoke all on function public.fn_hotmart_nome_oferta(text) from public, anon, authenticated;
grant execute on function public.fn_hotmart_nome_oferta(text) to service_role;

comment on function public.fn_hotmart_nome_oferta(text) is
  'Nome da oferta da Hotmart (fin.ofertas) para o aviso de venda no Slack. Só service_role. 0324.';
