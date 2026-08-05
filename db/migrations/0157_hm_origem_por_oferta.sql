-- =====================================================================
-- 0157_hm_origem_por_oferta
--
-- A ORIGEM DA VENDA PASSA A SAIR DA OFERTA (pedido do Marcio, 05/08/2026).
--
-- Contexto: o pitch do Aurum aconteceu no Encontro do Time Holding Brasil em
-- São Paulo, e toda venda da oferta qm4lu7py veio de lá. Precisamos que o card
-- nasça com a origem "ETHB SP" sem ninguém carimbar à mão.
--
-- POR QUE NÃO POR JANELA DE DATA (cs.hm_evento_janela), que era o caminho
-- óbvio: cs.fn_hm_janela_evento decide SÓ pela data e, em sobreposição, a
-- janela de `inicio` mais recente ganha —
--
--     select w.canal from cs.hm_evento_janela w
--      where p_venda_em >= w.inicio and p_venda_em < w.fim
--      order by w.inicio desc limit 1
--
-- e existe a janela 'HT29 - 26-07' ATIVA de 26/07 a 10/08 (turma T40, a
-- captação do Holding Masters rodando agora, 27 cards já carimbados). Uma
-- janela 'ETHB SP' começando hoje seria a mais recente e passaria a carimbar
-- TAMBÉM as vendas do HM do mesmo dia. Pior: cs.fn_sync_hm_atm, o recarimbador
-- que consome essas janelas, não conhece cs.contatos_hm.produto — não teria
-- como separar. Seria a captação do T40 contada como venda do encontro de SP,
-- sem erro nenhum aparecendo.
--
-- A oferta não tem esse problema: ela só existe no produto dela.
--
-- O precedente já existe na própria fn_tag_hm_origem — o branch da oferta
-- 6qxsk9kq devolve 'Acesso ETHB' olhando a oferta, não a data. Esta migration
-- generaliza aquilo para uma TABELA, para a próxima origem ser uma linha de
-- INSERT e não uma alteração de função.
--
-- CUIDADO AO REAPROVEITAR OFERTA: o vínculo aqui vale "para sempre". Se
-- qm4lu7py for reusada num segundo pitch em outra cidade, aquelas vendas
-- apareceriam como 'ETHB SP'. A recomendação (aceita pelo Marcio) é oferta
-- nova por evento. Se um dia precisar, dá para acrescentar janela de validade
-- nesta tabela — mas só quando precisar.
--
-- Idempotente.
-- Ver [[HM - Feature de equipes e niveis de acesso]] e 0155_contatos_hm_produto.
-- =====================================================================

-- ---------------------------------------------------------------- a tabela
create table if not exists cs.hm_origem_por_oferta (
  oferta_codigo text primary key,
  origem        text not null,
  nota          text,
  criado_em     timestamptz not null default now()
);

comment on table cs.hm_origem_por_oferta is
  'Oferta da Hotmart -> canal/origem do card na esteira. Lido por cs.fn_tag_hm_origem ANTES da derivação por data/edição. Cede para o override manual por pessoa (cs.hm_origem_oficial), que continua sendo a palavra final.';
comment on column cs.hm_origem_por_oferta.oferta_codigo is
  'public.compras.oferta_codigo (offer.code do payload da Hotmart).';
comment on column cs.hm_origem_por_oferta.origem is
  'O canal carimbado no card. Precisa bater EXATAMENTE com o nome usado na régua de canais do board (app/hm/_components/hm-canais.tsx) — é a mesma string.';

insert into cs.hm_origem_por_oferta (oferta_codigo, origem, nota) values
  ('qm4lu7py', 'ETHB SP',
   'Pitch do Aurum no Encontro do Time Holding Brasil - Sao Paulo, 05/08/2026.')
on conflict (oferta_codigo) do nothing;

-- ------------------------------------------------------------- a função
-- ATENÇÃO AO REVISAR: o corpo abaixo é a função em produção (md5 do
-- pg_get_functiondef em 05/08/2026: a9152f3d0d5b75c32855c77a53a4ab75) com UMA
-- adição, marcada por "-- [0157]". Nada mais mudou — nem espaço em branco.
-- O branch novo entra DEPOIS do override manual por pessoa e ANTES da
-- derivação por imersão/janela/edição, e só age quando v_canal ainda é null.
-- Assim a classificação de público ('Lead novo' / 'Aluno THB' / 'Aluno Aurum')
-- e as tags de turma continuam sendo calculadas normalmente — diferente do
-- branch do 6qxsk9kq, que faz early return porque ali é renovação e público
-- não importa.

CREATE OR REPLACE FUNCTION cs.fn_tag_hm_origem(p_comprador_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'cs', 'public', 'pg_temp'
AS $function$
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

  -- [0157] Origem POR OFERTA. Vem depois do override manual (hm_origem_oficial
  -- continua ganhando) e antes da derivação por imersão/janela/edição — a
  -- oferta é um fato mais forte que a data. Ver o cabeçalho da migration para
  -- por que NÃO usamos cs.hm_evento_janela aqui.
  if v_canal is null then
    select r.origem into v_canal
      from cs.hm_origem_por_oferta r
      join public.compras c on c.oferta_codigo = r.oferta_codigo
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
     order by coalesce(c.data_aprovacao, c.data_compra) desc
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
