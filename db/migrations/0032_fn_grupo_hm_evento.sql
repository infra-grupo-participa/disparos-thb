-- =====================================================================
-- 0032_fn_grupo_hm_evento
-- RPC usada pela Edge Function `grupo-hm-webhook` para aplicar a tag de grupo
-- no card HM quando o aluno entra/sai do grupo de WhatsApp (igual ao HT).
-- Casa o comprador (e-mail ou últimos 6 dígitos do telefone), acha o card HM e:
--   entrou → tag "No grupo"      (remove "Saiu do grupo")
--   saiu   → tag "Saiu do grupo" (remove "No grupo")
-- Registra na timeline só quando há mudança real. Executada via service_role.
-- Retorna 'entrou' | 'saiu' | 'sem_card' | 'nao_encontrado'.
-- =====================================================================
create or replace function public.fn_grupo_hm_evento(
  p_email text,
  p_u6    text,
  p_acao  text,   -- 'entrou' | 'saiu'
  p_grupo text
) returns text
language plpgsql
security definer
set search_path = public, cs
as $fn$
declare
  v_comprador uuid;
  v_ch uuid;
  v_saiu boolean := (p_acao = 'saiu');
  v_alvo text;
  v_oposto text;
  v_ja boolean;
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

  select id into v_ch from cs.contatos_hm where comprador_id = v_comprador limit 1;
  if v_ch is null then
    return 'sem_card';
  end if;

  v_alvo   := case when v_saiu then 'Saiu do grupo' else 'No grupo' end;
  v_oposto := case when v_saiu then 'No grupo' else 'Saiu do grupo' end;

  select (v_alvo = any(tags)) into v_ja from cs.contatos_hm where id = v_ch;

  update cs.contatos_hm
     set tags = array_append(array_remove(array_remove(tags, v_alvo), v_oposto), v_alvo),
         atualizado_em = now()
   where id = v_ch;

  if not coalesce(v_ja, false) then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (
      v_ch, 'sistema',
      case when v_saiu then 'Saiu do grupo' else 'Entrou no grupo' end || coalesce(' (' || nullif(p_grupo, '') || ')', ''),
      'grupo'
    );
  end if;

  return case when v_saiu then 'saiu' else 'entrou' end;
end$fn$;

revoke all on function public.fn_grupo_hm_evento(text, text, text, text) from public;
grant execute on function public.fn_grupo_hm_evento(text, text, text, text) to service_role;
