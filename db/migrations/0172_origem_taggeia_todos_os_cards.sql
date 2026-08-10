-- 0172_origem_taggeia_todos_os_cards.sql
-- Origem e PÚBLICO são fatos da PESSOA, não de um card.
--
-- Desde a 0163 a mesma pessoa pode ter card em mais de um board (HM, AURUM,
-- ETHB). `cs.fn_tag_hm_origem` continuou fazendo
--
--     select ... into v_card ... where ch.comprador_id = p_comprador_id
--
-- sem ordem — pega um card qualquer — e gravava as tags SÓ nesse card.
--
-- Achado no teste de venda simulada de 10/08 21h, cenário "quem já está no Aurum
-- compra a entrada de R$697": o card novo do HM nascia SEM tag de canal, porque a
-- tag ia para o card do Aurum. Efeito prático: a venda existia, o dinheiro
-- entrava, mas ela não contava no placar de "HT30 - 10-08" — justamente o número
-- que a operação abre o dia perguntando. Um erro que não aparece em lugar nenhum:
-- não há exceção, não há log, só um card a menos na régua.
--
-- Correção em duas partes:
--   1) o card de LEITURA vira determinístico: prefere o card do HM (o board
--      histórico, onde a esteira roda), empata pelo mais antigo. Ele segue sendo
--      o dono das observações e da interação de origem — essas são texto de
--      ficha, e duplicar em todo board seria ruído.
--   2) as TAGS passam a ser gravadas em TODOS os cards da pessoa. Canal e público
--      descrevem de onde ela veio e quem ela é; valem em qualquer board. A régua
--      de cada portal já filtra os canais que interessam a ele
--      (app/hm/_components/hm-canais.tsx), então a tag do HM não polui a régua do
--      Aurum.
--
-- Verificado depois da mudança, no mesmo teste revertido:
--   AURUM [Aluno THB|AURUM|ETHB SP|HT30 - 10-08|Origem T35]
--   HM    [Aluno THB|HT30 - 10-08|Origem T35]  ← antes vinha vazio
--   card HM: pacote R$ 15.000 · pago R$ 697 · saldo R$ 14.303
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
  -- 0172: card de leitura determinístico (HM primeiro, depois o mais antigo).
  select ch.id, ch.tags, ch.observacoes, ch.turma_origem, ch.aluno_id,
         lower(trim(cmp.email)) as email,
         regexp_replace(coalesce(cmp.documento,''), '[^0-9]', '', 'g') as doc,
         right(regexp_replace(coalesce(cmp.telefone,''), '[^0-9]', '', 'g'), 10) as tel10
    into v_card from cs.contatos_hm ch join public.compradores cmp on cmp.id = ch.comprador_id
   where ch.comprador_id = p_comprador_id
   order by (ch.produto = 'HM') desc, ch.criado_em asc
   limit 1;
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
     where comprador_id = p_comprador_id;          -- 0172: todos os cards
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

  -- [0157 + 0167] Origem POR OFERTA, com JANELA. Vem depois do override manual e
  -- antes da derivação por imersão/janela/edição — a oferta é um fato mais forte
  -- que a data. A janela só desempata entre edições da MESMA oferta.
  if v_canal is null then
    select r.origem into v_canal
      from cs.hm_origem_por_oferta r
      join public.compras c on c.oferta_codigo = r.oferta_codigo
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and (r.vale_de  is null or coalesce(c.data_compra, c.data_aprovacao) >= r.vale_de)
       and (r.vale_ate is null or coalesce(c.data_compra, c.data_aprovacao) <  r.vale_ate)
     order by coalesce(c.data_aprovacao, c.data_compra) desc,
              (r.vale_de is not null or r.vale_ate is not null) desc
     limit 1;
  end if;

  if v_canal is null then
    v_canal := cs.fn_hm_canal_imersao(p_comprador_id);
    if v_canal is null and v_dt is not null then
      v_ev := cs.fn_hm_janela_evento(v_dt);
      if v_ev = 'HT ATM' then
        v_canal := case when v_na_base then 'HM - Programa de Implementação' else 'HT ATM' end;
      elsif v_ev is not null and v_ev <> 'Venda direta' then
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

  -- 0172: canal e público valem para a PESSOA — todos os cards dela recebem.
  update cs.contatos_hm
     set tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(tags,'{}') || v_novas) t),
         atualizado_em = now()
   where comprador_id = p_comprador_id;

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
