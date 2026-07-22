-- =====================================================================
-- 0123_hm_canal_fonte_unica_e_resync
--
-- Reorganiza o CANAL de aquisição do HM (decisão 22/07). Escada única:
--   1. Imersão POA
--   2. Evento do sinal (Live / HT ATM / Ex aluno) — datado pela DATA DA COMPRA,
--      via fonte única cs.fn_hm_janela_evento — GANHA do "Programa"
--   3. Edição HT (HT26/27/28…)
--   4. Aluno da base sem evento → HM - Programa de Implementação
--   5. Venda direta
-- Antes: "aluno da base" parava em "Programa" e escondia o evento (76 cards);
-- boleto do evento pago fora da janela virava "Venda direta" (4). O público
-- (Lead novo / Aluno THB / Aurum) NÃO muda. v_dt passa a olhar QUALQUER oferta
-- de sinal (não só z391kxd9), resolvendo os "sem canal".
-- Também conserta fn_sync_hm_atm: a limpeza de tags só removia 5 tags antigas;
-- agora limpa todo canal/público/turma antes de recarimbar (senão deixa lixo).
--
-- Pós-migration: rodar `select * from cs.fn_sync_hm_atm();` (re-tagueia todos).
-- Resultado 22/07: HT ATM 17→94, Ex aluno 39→44, Programa 87→14, sem-canal 5→3.
-- =====================================================================

create or replace function cs.fn_tag_hm_origem(p_comprador_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_card record; al record;
  v_na_base boolean := false;
  v_publico text; v_canal text; v_dt timestamptz; v_ev text;
  v_turma_thb text; v_turma_aur text; v_espaco text; v_resumo text;
  v_marcador constant text := E'⟦HM origem⟧';
  v_novas text[];
begin
  select ch.id, ch.tags, ch.observacoes, ch.turma_origem, ch.aluno_id,
         lower(trim(cmp.email)) as email,
         right(regexp_replace(coalesce(cmp.telefone,''), '[^0-9]', '', 'g'), 10) as tel10
    into v_card from cs.contatos_hm ch join public.compradores cmp on cmp.id = ch.comprador_id
   where ch.comprador_id = p_comprador_id;
  if not found then return null; end if;

  -- data da 1ª compra de SINAL (qualquer oferta de sinal), pela DATA DA COMPRA
  select min(coalesce(c.data_compra, c.data_aprovacao)) into v_dt
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo and cat.categoria = 'sinal'
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED');

  select v.turma_codigo, v.turma_aurum_id, ta.codigo as turma_aurum, v.espaco_instrucao,
         v.profissao, v.cidade, v.estado, v.eh_socio
    into al from public.vw_aluno_360 v
    left join public.thb_turmas ta on ta.id = v.turma_aurum_id
   where not (coalesce(v.fonte,'') in ('sip_ativacao_hm','webhook_hotmart_hm')
              and coalesce(v.turma_codigo,'') = cs.fn_hm_turma_atual())
     and (v.comprador_id = p_comprador_id
      or (v.email is not null and lower(trim(v.email)) = v_card.email and v_card.email <> '')
      or (length(v_card.tel10) = 10
          and right(regexp_replace(coalesce(v.telefone_e164, v.telefone,''), '[^0-9]', '', 'g'), 10) = v_card.tel10))
   order by (v.comprador_id = p_comprador_id) desc nulls last,
            (lower(trim(v.email)) = v_card.email) desc nulls last
   limit 1;
  v_na_base := found;

  if not v_na_base then v_publico := 'Lead novo';
  else
    v_turma_thb := coalesce(v_card.turma_origem, nullif(nullif(trim(al.turma_codigo),''), cs.fn_hm_turma_atual()));
    v_turma_aur := nullif(trim(al.turma_aurum),'');
    if al.espaco_instrucao = 'aurum' or al.turma_aurum_id is not null then v_publico := 'Aluno Aurum';
    else v_publico := 'Aluno THB'; end if;
    if v_card.turma_origem is null and v_turma_thb is not null then
      update cs.contatos_hm set turma_origem = v_turma_thb where id = v_card.id;
    end if;
  end if;

  -- CANAL — escada única (ver cabeçalho). Evento do sinal ganha do "Programa".
  v_canal := cs.fn_hm_canal_imersao(p_comprador_id);
  if v_canal is null and v_dt is not null then
    v_ev := cs.fn_hm_janela_evento(v_dt);
    if v_ev <> 'Venda direta' then v_canal := v_ev; end if;
  end if;
  if v_canal is null then
    v_canal := cs.fn_hm_edicao_ht(p_comprador_id);
  end if;
  if v_canal is null then
    if v_na_base then v_canal := 'HM - Programa de Implementação';
    elsif v_dt is not null then v_canal := 'Venda direta';
    end if;
  end if;

  v_novas := array_remove(array[
    v_publico, v_canal,
    case when v_turma_thb is not null then 'Origem ' || v_turma_thb end,
    case when v_turma_aur is not null then 'Aurum ' || v_turma_aur end,
    case when v_card.aluno_id is not null then 'Turma ' || cs.fn_hm_turma_atual() end
  ], null);

  update cs.contatos_hm
     set tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(tags,'{}') || v_novas) t),
         atualizado_em = now()
   where id = v_card.id;

  if v_na_base and position(v_marcador in coalesce(v_card.observacoes,'')) = 0 then
    v_espaco := initcap(replace(coalesce(al.espaco_instrucao,''), '_', ' '));
    v_resumo := concat_ws(' · ', v_publico,
      case when v_turma_thb is not null then 'THB ' || v_turma_thb end,
      case when v_turma_aur is not null then 'Aurum ' || v_turma_aur end,
      nullif(v_espaco,''), nullif(concat_ws('/', nullif(al.cidade,''), nullif(al.estado,'')), ''),
      nullif(al.profissao,''), case when al.eh_socio then 'Sócio' end);
    update cs.contatos_hm
       set observacoes = trim(both E'\n' from coalesce(observacoes,'') || E'\n' || v_marcador || ' ' || v_resumo),
           atualizado_em = now()
     where id = v_card.id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card.id, 'sistema', 'Origem HM: ' || v_resumo, 'sistema');
  end if;
  return v_publico;
end$function$;

-- Conserto do re-sync: limpa TODO canal/público/turma antes de recarimbar.
create or replace function cs.fn_sync_hm_atm(p_desde timestamp with time zone default '2000-01-01 03:00:00+00'::timestamptz)
 returns TABLE(cards_alvo integer, aurum integer, hm integer, novo integer)
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  r record; v_pub text;
  n_alvo int := 0; n_a int := 0; n_h int := 0; n_n int := 0;
begin
  for r in select ch.comprador_id, ch.id as card_id from cs.contatos_hm ch where ch.criado_em >= p_desde
  loop
    n_alvo := n_alvo + 1;
    update cs.contatos_hm
       set tags = (
         select coalesce(array_agg(t), '{}')
           from unnest(tags) t
          where t not in ('HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto',
                          'HM - Programa de Implementação','Venda direta','Lead novo','Aluno THB','Aluno Aurum')
            and t !~ '^HT[0-9]+$'
            and t !~ '^(Turma|Origem|Aurum) '
       ),
       observacoes = nullif(trim(both E'\n' from
         regexp_replace(coalesce(observacoes, ''), E'\\n?⟦(HT ATM|HM origem)⟧.*$', '')), '')
     where id = r.card_id;

    delete from cs.interacoes i
     where i.contato_hm_id = r.card_id
       and i.tipo = 'sistema'
       and (i.descricao like 'Origem HM:%' or i.descricao like 'Aluno identificado na base (HT ATM)%');

    v_pub := cs.fn_tag_hm_origem(r.comprador_id);
    if    v_pub = 'Aurum' then n_a := n_a + 1;
    elsif v_pub = 'HM'    then n_h := n_h + 1;
    else                       n_n := n_n + 1;
    end if;
  end loop;
  return query select n_alvo, n_a, n_h, n_n;
end$function$;
