-- 0167_canal_por_janela_da_oferta.sql
-- SEGUNDA EDIÇÃO DO PITCH: a live do HT de HOJE (10/08, 20h) vende a MESMA oferta
-- `rlgjsrul` (R$697) que a live de ontem. O Marcio quer os dois públicos SEPARADOS
-- na régua do board do HM: quem comprou ontem em "HT30 - 09-08", quem comprar hoje
-- em "HT30 - 10-08".
--
-- ---------------------------------------------------------------------------
-- POR QUE A 0160 NÃO RESOLVE ISSO SOZINHA
--
-- `cs.hm_origem_por_oferta` tinha PRIMARY KEY (oferta_codigo): UMA origem por
-- oferta, para sempre. Como as duas lives usam o MESMO código, toda venda de hoje
-- nasceria com a tag de ontem — os dois pitches viveriam somados num canal só, e o
-- placar da régua deixaria de responder "quanto veio de cada live?".
--
-- Confirmado com o Marcio (10/08, 19h30): é a mesma oferta na Hotmart. Então o que
-- separa os dois canais é a HORA DA COMPRA, e a tabela passa a aceitar mais de uma
-- linha por oferta, cada uma valendo numa JANELA — [vale_de, vale_ate).
--
-- Isto NÃO ressuscita a derivação por data que a 0157 rejeitou. Lá o problema era
-- derivar o canal de um proxy fraco (a janela do INGRESSO do HT, que trazia a
-- edição errada — caso Gabriela). Aqui a oferta continua sendo o fato forte: a
-- janela só desempata entre duas edições da MESMA oferta. Fora desse caso, a linha
-- sem janela (vale_de/vale_ate nulos) segue valendo para tudo, como antes.
--
-- ---------------------------------------------------------------------------
-- ONDE CORTAR — e quem muda de valor
--
-- Corte: **10/08/2026 12:00 BRT**. Medido antes de aplicar:
--   · compras de `rlgjsrul` a partir de 10/08 12:00 ....... 0
--   · cards hoje com a tag "HT30 - 09-08" ................ 20
-- Ou seja: NENHUM card existente muda de canal — a última venda de ontem entrou
-- 03:20 da madrugada (rescaldo da live), e nada mais caiu até agora (19:28). O
-- corte ao meio-dia é folgado dos dois lados: preserva o rescaldo da madrugada em
-- 09-08 e pega tudo que a live das 20h converter.
--
-- Idempotente: roda de novo sem efeito.

-- ---------------------------------------------------------------------------
-- 1) A tabela passa a aceitar mais de uma janela por oferta
-- ---------------------------------------------------------------------------
alter table cs.hm_origem_por_oferta
  add column if not exists vale_de  timestamptz,
  add column if not exists vale_ate timestamptz;

comment on column cs.hm_origem_por_oferta.vale_de is
  'Início da janela (inclusivo) em que esta origem vale para a oferta. NULL = sem limite inferior.';
comment on column cs.hm_origem_por_oferta.vale_ate is
  'Fim da janela (EXCLUSIVO) em que esta origem vale para a oferta. NULL = sem limite superior.';

alter table cs.hm_origem_por_oferta
  drop constraint if exists hm_origem_por_oferta_pkey;

-- Unique por (oferta, início da janela). O coalesce dá identidade à linha "sem
-- janela" — sem ele, duas linhas com vale_de nulo passariam pelo unique (NULL não
-- colide com NULL) e a oferta voltaria a ter origem ambígua.
create unique index if not exists hm_origem_por_oferta_chave
  on cs.hm_origem_por_oferta (oferta_codigo, coalesce(vale_de, '-infinity'::timestamptz));

-- Janela invertida é erro de digitação, não configuração: barra na escrita.
alter table cs.hm_origem_por_oferta
  drop constraint if exists hm_origem_por_oferta_janela_check;
alter table cs.hm_origem_por_oferta
  add constraint hm_origem_por_oferta_janela_check
  check (vale_de is null or vale_ate is null or vale_de < vale_ate);

-- ---------------------------------------------------------------------------
-- 2) As duas edições do pitch
-- ---------------------------------------------------------------------------
update cs.hm_origem_por_oferta
   set vale_ate = '2026-08-10 12:00:00-03',
       nota = 'Live do HT de 09/08/2026 (1a edicao do pitch da entrada R$697). '
              'Vale ate 10/08 12:00 BRT: a partir dai a mesma oferta pertence a live de 10/08. '
              'Canal vem da OFERTA + JANELA, nunca da data sozinha.'
 where oferta_codigo = 'rlgjsrul'
   and origem = 'HT30 - 09-08';

insert into cs.hm_origem_por_oferta (oferta_codigo, origem, nota, produto, vale_de, vale_ate)
values ('rlgjsrul', 'HT30 - 10-08',
        'Live do HT de 10/08/2026, 20h (2a edicao do pitch da entrada R$697). Mesma oferta da '
        'vespera na Hotmart: o que separa os dois canais e a janela de compra.',
        'HM', '2026-08-10 12:00:00-03', null)
on conflict (oferta_codigo, coalesce(vale_de, '-infinity'::timestamptz)) do update
  set origem = excluded.origem,
      nota   = excluded.nota,
      produto = excluded.produto,
      vale_ate = excluded.vale_ate;

-- ---------------------------------------------------------------------------
-- 3) fn_tag_hm_origem — o ramo da oferta passa a respeitar a janela
--
-- Muda SÓ o bloco [0157]; o resto da função é idêntico ao que está em produção
-- (0139 + 0157). Ordem do desempate, quando a pessoa tem mais de uma compra
-- casando:
--   1º a compra mais recente  — o último fato que a pessoa produziu;
--   2º a linha COM janela     — janela específica ganha da linha coringa da mesma
--      oferta, senão as duas empatariam e o canal viraria sorteio.
-- ---------------------------------------------------------------------------
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

  -- [0157 + 0167] Origem POR OFERTA, agora com JANELA. Vem depois do override
  -- manual (hm_origem_oficial continua ganhando) e antes da derivação por
  -- imersão/janela/edição — a oferta é um fato mais forte que a data. A janela só
  -- desempata entre edições da MESMA oferta (as duas lives do HT com a R$697);
  -- linha sem janela segue valendo para toda a vida da oferta.
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

-- ---------------------------------------------------------------------------
-- 4) fn_hm_card_da_oferta — blinda contra a oferta com mais de uma linha
--
-- A 0163 fazia `left join cs.hm_origem_por_oferta o on o.oferta_codigo = p_oferta`
-- para descobrir o PRODUTO da oferta. Com duas janelas na `rlgjsrul` esse join
-- passa a devolver duas linhas por card, e o `limit 1` sobre um order by que
-- empata vira sorteio: o pagamento de R$697 podia ser lançado no card errado de
-- quem tem card no HM e no Aurum. O produto é o mesmo nas duas janelas, então
-- basta pegá-lo UMA vez, por subquery, em vez de multiplicar as linhas.
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_card_da_oferta(p_comprador uuid, p_oferta text)
returns uuid language sql stable
set search_path to 'cs','public','pg_temp'
as $function$
  select ch.id
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador
   order by
     -- 1º: card cujo produto casa com o produto declarado da oferta
     (ch.produto is not distinct from (
        select o.produto from cs.hm_origem_por_oferta o
         where o.oferta_codigo = p_oferta
         order by o.vale_de desc nulls last limit 1)) desc nulls last,
     -- 2º: o mais antigo (comportamento histórico)
     ch.criado_em asc
   limit 1;
$function$;

comment on function cs.fn_hm_card_da_oferta(uuid, text) is
  'Card em que um pagamento deve ser lançado quando a pessoa tem card em mais de um board (0163). Prefere o card do produto da oferta; empata pelo mais antigo. 0167: produto lido por subquery — a oferta pode ter mais de uma janela de origem.';
