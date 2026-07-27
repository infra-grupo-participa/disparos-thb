-- =====================================================================
-- 0139_hm_canal_ht29_t40
--
-- Canal NOVO "HT29 - 26-07" no board /hm: quem paga o sinal na LIVE de
-- 26/07/2026 (abre a turma T40). Decisões do Marcio (26/07):
--   • TODOS na mesma origem — base e lead juntos no canal único (NÃO separa
--     aluno-base em "Programa" como o HT ATM). "Vêm todos da mesma oferta."
--   • Esquema de sempre: novos pagam Sinal R$300 (z391kxd9) + R$14.700 de
--     diferença depois; saldos (6qxsk9kq…) são de alunos antigos.
--   • Janela de VÁRIOS DIAS (a definir a data final; placeholder 10/08 abaixo).
--
-- Em vez de hardcodar mais um nome, as funções passam a reconhecer QUALQUER
-- canal da tabela cs.hm_evento_janela (config-driven, 0130) — T40, T41… entram
-- só com 1 INSERT, sem nova migration. Fecha a ARMADILHA da 0128 de raiz.
--
-- 4 pontos (checklist de "canal novo"):
--   1) fn_tag_hm_origem  — o ramo de janela passa a APLICAR qualquer nome ≠ HT ATM
--      e ≠ 'Venda direta' (antes só Live/Ex aluno). HT ATM mantém o desvio especial.
--   2) fn_sync_hm_atm    — a limpeza também remove canais de hm_evento_janela.
--   3) fn_hm_health_check— o monitor sem_canal (detecção + auto-resolve) reconhece
--      canais de hm_evento_janela → não acusa HT29 como falso "sem canal".
--   4) INSERT da janela  + régua CANAIS_FIXOS no front (fora do SQL).
--
-- Pós: catalogar as ofertas da T40 conforme o CSV do Marcio (se o sinal for uma
-- oferta NOVA, cadastrar como categoria 'sinal' senão a compra não vira card;
-- se reusa z391kxd9, nada a fazer) + `select cs.fn_sync_hm_atm('2026-07-26 00:00:00-03');`
-- Ver [[HM - Ofertas, tags e janelas de evento]].
-- =====================================================================

-- 1) fn_tag_hm_origem — generaliza o ramo de janela (troca só o elsif) ---------
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

  if exists (
    select 1 from public.compras c
     where c.comprador_id = p_comprador_id
       and c.oferta_codigo = '6qxsk9kq'
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
  ) then
    update cs.contatos_hm
       set tags = (
         select coalesce(array_agg(distinct t), '{}')
           from unnest(
             array(select x from unnest(coalesce(tags,'{}')) x
                    where x not in ('Lead novo','Aluno THB','Aluno Aurum','Venda direta',
                                    'HT ATM','Live Direto ao Ponto','Imersão POA',
                                    'Ex aluno Direto ao Ponto','HM - Programa de Implementação')
                      and x !~ '^HT[0-9]+$')
             || array['Acesso ETHB','Renovação']
           ) t),
           atualizado_em = now()
     where id = v_card.id;
    return 'Acesso ETHB';
  end if;

  select min(coalesce(c.data_compra, c.data_aprovacao)) into v_dt
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo and cat.categoria = 'sinal'
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED');

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
      elsif v_ev is not null and v_ev <> 'Venda direta' then
        -- Qualquer outra janela nomeada (Live, Ex aluno, HT29 - 26-07, T40…) vale
        -- para TODOS os públicos. Só o HT ATM separa base→Programa (regra histórica).
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

-- 2) fn_sync_hm_atm — a limpeza também gerencia canais de hm_evento_janela -----
create or replace function cs.fn_sync_hm_atm(p_desde timestamp with time zone default '2000-01-01 03:00:00+00'::timestamptz)
 returns table(cards_alvo integer, aurum integer, hm integer, novo integer)
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
                          'HM - Programa de Implementação','Venda direta','Lead novo','Aluno THB','Aluno Aurum',
                          'Acesso ETHB','Renovação')
            and t !~ '^HT[0-9]+$'
            and t !~ '^(Turma|Origem|Aurum) '
            and t not in (select canal from cs.hm_evento_janela)   -- canais-janela (HT29 - 26-07, T40…) são gerenciados
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

-- 3) fn_hm_health_check — o monitor sem_canal reconhece canais de hm_evento_janela
create or replace function cs.fn_hm_health_check()
 returns table(tipo text, novos integer, abertos integer)
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'oferta_orfa', coalesce(c.oferta_codigo,'(nula)'), 'critico',
         'Oferta '||coalesce(c.oferta_codigo,'(nula)')||' fora do catálogo — '||count(*)||
         ' compra(s) aprovada(s); pagamento não vira card/razão. Cadastrar em hm_product_catalog.'
    from public.compras c
   where c.produto_id in ('5064314','3507214')
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and not exists (select 1 from public.hm_product_catalog cat where cat.offer_code = c.oferta_codigo)
   group by c.oferta_codigo
   on conflict do nothing;

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'card_faltando', c.comprador_id::text, 'critico',
         'Comprador '||cp.email||' pagou ('||string_agg(distinct cat.categoria,'/')||') e não tem card na esteira.'
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
    join public.compradores cp on cp.id = c.comprador_id
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia','diferenca')
     and coalesce(c.data_aprovacao, c.data_compra) >= v_cutoff
     and not exists (
       select 1 from cs.contatos_hm ch
        where ch.comprador_id = coalesce(
          (select canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
          c.comprador_id))
   group by c.comprador_id, cp.email
   on conflict do nothing;

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'sem_canal', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' sem canal de aquisição (rodar cs.fn_sync_hm_atm ou conferir oferta de entrada).'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
   where not exists (
     select 1 from unnest(coalesce(ch.tags,'{}')) t
      where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta','Renovação'])
         or t ~ '^HT[0-9]+$'
         or t in (select canal from cs.hm_evento_janela))
   on conflict do nothing;

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'duplicado', doc, 'aviso', 'CPF '||doc||' com 2+ cadastros na Hotmart ('||string_agg(distinct email,' / ')||') — conferir alias.'
    from (
      select regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g') doc, lower(trim(cp.email)) email
        from public.compradores cp
       where (exists (select 1 from cs.contatos_hm ch where ch.comprador_id=cp.id)
              or exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code=c.oferta_codigo
                          where c.comprador_id=cp.id and c.status in ('APPROVED','COMPLETE','COMPLETED')))
         and not exists (select 1 from cs.hm_comprador_alias a where a.comprador_id=cp.id)
         and length(regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g'))=11
    ) x
   group by doc
   having count(distinct email) > 1
   on conflict do nothing;

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'boleto_preso', co.hotmart_transaction, 'aviso',
         'Boleto de '||cp.email||' ('||co.oferta_codigo||') impresso em '||
         to_char(coalesce(co.data_compra,co.criado_em),'DD/MM')||' e parado há '||
         (now()::date - coalesce(co.data_compra,co.criado_em)::date)||
         ' dias — conferir na Hotmart: se PAGOU, atualizar status (pagamento invisível); se EXPIROU, baixar.'
    from public.compras co
    join public.compradores cp on cp.id = co.comprador_id
   where co.produto_id in ('5064314','3507214')
     and co.status in ('BILLET_PRINTED','PRINTED_BILLET')
     and coalesce(co.data_compra,co.criado_em) < now() - interval '10 days'
     and not exists (
       select 1 from public.compras c2
        where c2.comprador_id = co.comprador_id and c2.oferta_codigo = co.oferta_codigo
          and c2.status in ('APPROVED','COMPLETE','COMPLETED'))
   on conflict do nothing;

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'reembolso_sem_baixa', ch.comprador_id::text, 'aviso',
         'Card '||cp.email||' está em "'||e.nome||'" mas a compra segue aprovada no banco — '||
         'reembolso/chargeback pode não ter dado baixa (razão conta como recebido). Conferir na Hotmart.'
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
    join cs.estagios e on e.id = ch.estagio_id
   where e.chave in ('hm_cancelamento','hm_reembolsado')
     and exists (select 1 from public.compras c
                  where c.comprador_id = ch.comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED'))
     and not exists (select 1 from public.compras c
                  where c.comprador_id = ch.comprador_id and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
   on conflict do nothing;

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='card_faltando'
     and exists (select 1 from cs.contatos_hm ch where ch.comprador_id::text = a.chave);

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='sem_canal'
     and exists (
       select 1 from cs.contatos_hm ch
        where ch.comprador_id::text = a.chave
          and exists (select 1 from unnest(coalesce(ch.tags,'{}')) t
                       where t = any(array['HT ATM','Live Direto ao Ponto','Imersão POA','Ex aluno Direto ao Ponto','HM - Programa de Implementação','Venda direta','Renovação'])
                          or t ~ '^HT[0-9]+$'
                          or t in (select canal from cs.hm_evento_janela)));

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='boleto_preso'
     and not exists (select 1 from public.compras co
                      where co.hotmart_transaction = a.chave and co.status in ('BILLET_PRINTED','PRINTED_BILLET'));

  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo='reembolso_sem_baixa'
     and (exists (select 1 from public.compras c
                   where c.comprador_id::text = a.chave and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED'))
          or not exists (select 1 from cs.contatos_hm ch join cs.estagios e on e.id=ch.estagio_id
                          where ch.comprador_id::text = a.chave and e.chave in ('hm_cancelamento','hm_reembolsado')));

  return query
    select a.tipo, count(*) filter (where a.detectado_em > now()-interval '1 min')::int as novos,
           count(*) filter (where a.resolvido_em is null)::int as abertos
    from cs.hm_alertas a group by a.tipo;
end$function$;

-- 4) A janela do canal HT29 — CONFIRMAR A DATA FINAL (placeholder 10/08) -------
--    início: hoje 26/07 00:00 (-03). fim: exclusivo. turma T40. Sem sobreposição
--    com as janelas T39 existentes (Live 25-27/06, HT ATM 06-08/07, Ex aluno 13-14/07).
insert into cs.hm_evento_janela (canal, inicio, fim, turma, nota) values
  ('HT29 - 26-07', '2026-07-26 00:00:00-03', '2026-08-10 00:00:00-03', 'T40', 'Captação T40 — live HT29 de 26/07');

-- 5) CATÁLOGO DAS OFERTAS DA T40 (conforme CSV do Marcio) ----------------------
--    Se o sinal reusa z391kxd9, já está catalogado ('sinal') → nada a fazer.
--    Se houver oferta NOVA de sinal, cadastrar aqui (senão a compra não vira card):
--    insert into public.hm_product_catalog (offer_code, product_id, categoria, notes)
--    values ('<offer>', '<produto>', 'sinal', 'Sinal R$300 T40');   -- ajustar por linha do CSV
--    (diferença/saldo entram igual, na categoria certa.)

-- 6) RE-SYNC — recarimba os cards a partir da virada, agora reconhecendo a janela
select cs.fn_sync_hm_atm('2026-07-26 00:00:00-03');
