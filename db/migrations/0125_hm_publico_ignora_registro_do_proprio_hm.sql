-- =====================================================================
-- 0125_hm_publico_ignora_registro_do_proprio_hm
--
-- "Aluno THB / Aurum" (público) só vale se a pessoa JÁ ERA aluno — registro de
-- turma anterior de fonte NÃO-HM. Antes o matching só excluía registros HM da
-- turma atual, deixando `sip_sinal_trilha` (registro que o PRÓPRIO sinal cria)
-- passar → 77 leads viravam "falso Aluno THB" e, no HT ATM, caíam em "Programa"
-- em vez de "HT ATM". Agora ignora todos os registros criados pelo HM
-- (sip_ativacao_hm / webhook_hotmart_hm / sip_sinal_trilha). Alinha com a planilha.
-- Corpo final de fn_tag_hm_origem (override oficial + escada de canal por público).
-- Pós: rodar `select * from cs.fn_sync_hm_atm();`. Resultado 22/07: Programa 86,
-- Ex aluno 44, HT ATM 19, Live 15 — espelha a planilha do Marcio.
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
         regexp_replace(coalesce(cmp.documento,''), '[^0-9]', '', 'g') as doc,
         right(regexp_replace(coalesce(cmp.telefone,''), '[^0-9]', '', 'g'), 10) as tel10
    into v_card from cs.contatos_hm ch join public.compradores cmp on cmp.id = ch.comprador_id
   where ch.comprador_id = p_comprador_id;
  if not found then return null; end if;

  select min(coalesce(c.data_compra, c.data_aprovacao)) into v_dt
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo and cat.categoria = 'sinal'
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED');

  -- Aluno "de verdade" = registro de fonte NÃO-HM (turma anterior real).
  select v.turma_codigo, v.turma_aurum_id, ta.codigo as turma_aurum, v.espaco_instrucao,
         v.profissao, v.cidade, v.estado, v.eh_socio
    into al from public.vw_aluno_360 v
    left join public.thb_turmas ta on ta.id = v.turma_aurum_id
   where coalesce(v.fonte,'') not in ('sip_ativacao_hm','webhook_hotmart_hm','sip_sinal_trilha')
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

  -- CANAL. 1º: override oficial (planilha). Casa por e-mail ou CPF.
  select o.canal into v_canal
    from cs.hm_origem_oficial o
   where (o.email is not null and lower(trim(o.email)) = v_card.email and v_card.email <> '')
      or (o.documento is not null and o.documento = v_card.doc and length(v_card.doc) >= 11)
   limit 1;

  if v_canal is null then
    v_canal := cs.fn_hm_canal_imersao(p_comprador_id);
    if v_canal is null and v_dt is not null then
      v_ev := cs.fn_hm_janela_evento(v_dt);
      if v_ev = 'HT ATM' then
        v_canal := case when v_na_base then 'HM - Programa de Implementação' else 'HT ATM' end;
      elsif v_ev in ('Live Direto ao Ponto', 'Ex aluno Direto ao Ponto') then
        v_canal := v_ev;
      end if;
    end if;
    if v_canal is null then
      v_canal := cs.fn_hm_edicao_ht(p_comprador_id);
    end if;
    if v_canal is null then
      if v_na_base then v_canal := 'HM - Programa de Implementação';
      elsif v_dt is not null then v_canal := 'Venda direta';
      end if;
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
