-- =====================================================================
-- 0029_fn_respondi_hm_form
-- RPC usada pela Edge Function `respondi-hm-webhook` para gravar as respostas
-- do formulário do Respondi em cs.* SEM expor o schema `cs` no PostgREST.
-- Casa o comprador (e-mail ou últimos 6 dígitos do telefone), faz upsert em
-- cs.formularios (tipo `hm_*`) e marca a timeline do card HM. Retorna
-- 'matched' | 'nao_encontrado'. Executada via service_role.
-- =====================================================================
create or replace function public.fn_respondi_hm_form(
  p_email     text,
  p_u6        text,
  p_tipo      text,
  p_respostas jsonb,
  p_pontuacao numeric
) returns text
language plpgsql
security definer
set search_path = public, cs
as $fn$
declare
  v_comprador uuid;
  v_ch uuid;
begin
  if p_email is not null and p_email <> '' then
    select id into v_comprador from public.compradores where lower(email) = lower(p_email) limit 1;
  end if;
  if v_comprador is null and p_u6 is not null and p_u6 <> '' then
    select id into v_comprador from public.compradores
     where right(regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'), 6) = p_u6
     limit 1;
  end if;
  if v_comprador is null then
    return 'nao_encontrado';
  end if;

  insert into cs.formularios (comprador_id, tipo, respostas, pontuacao, respondido_em)
  values (v_comprador, p_tipo, coalesce(p_respostas, '{}'::jsonb), p_pontuacao, now())
  on conflict (comprador_id, tipo)
  do update set respostas = excluded.respostas, pontuacao = excluded.pontuacao,
                respondido_em = now(), atualizado_em = now();

  select id into v_ch from cs.contatos_hm where comprador_id = v_comprador limit 1;
  if v_ch is not null then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_ch, 'sistema', 'Respondeu o formulário ('||p_tipo||')', 'respondi');
  end if;

  return 'matched';
end$fn$;

revoke all on function public.fn_respondi_hm_form(text, text, text, jsonb, numeric) from public;
grant execute on function public.fn_respondi_hm_form(text, text, text, jsonb, numeric) to service_role;
