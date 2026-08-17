-- 0251_a_pessoa_e_o_componente_conexo_nao_o_email_nem_o_cpf.sql
--
-- Terceira e última tentativa de responder "quem é essa pessoa?" na conciliação da Hotmart.
-- As duas primeiras erraram por motivos opostos, e vale registrar as duas:
--
--   0249 casou por E-MAIL       → escondeu 6 pagantes que estão na base com outro endereço
--   0250 casou por DOCUMENTO    → separou 5 pessoas que compraram um ciclo como PF e o
--                                 seguinte pelo CNPJ do próprio escritório
--
-- Os 5 casos da 0250, todos com o MESMO e-mail nos dois ciclos:
--
--   Ataize Scharmach ........ A7 pelo CNPJ 30127300000105 · 2026.01 pelo CPF 04008106979
--   Jayne Naoum ............. A7 pelo CNPJ 53186168000108 · 2026.01 pelo CPF 29282039153
--   Aline Alencar ........... A7 pela "Aline Alencar Soc. Individual" · 2025.02 pela PF
--   Márcia Romano Vaz ....... A7 pela "Infinity Solutions"           · 2025.02 pela PF
--   Théo Campomar Macchi .... A7 pelo CNPJ 49882044000181            · 2026.01 pelo CPF
--
-- Nenhum dos dois campos é identidade sozinho. **Identidade é o componente conexo** do grafo
-- em que e-mail e documento são nós e cada transação é uma aresta entre eles: se a Ataize
-- pagou com (e-mail X, CNPJ) e com (e-mail X, CPF), então CNPJ, CPF e X são a mesma pessoa.
--
-- O fechamento é calculado por propagação de rótulo até estabilizar — não por uma passada
-- só, porque cadeias de comprimento 3 (doc → e-mail → outro doc → outro e-mail) existem e
-- uma passada as deixaria pela metade. O laço tem teto de 20 rodadas e falha alto se não
-- convergir, em vez de gravar um resultado incompleto em silêncio.
--
-- Fica numa TABELA, não numa view: o cálculo é iterativo e não cabe em view sem recursão
-- confusa, e materializado ele custa zero na leitura da Central. É recalculado pela função
-- toda vez que `cs.hotmart_pessoa` recebe um export novo.
--
-- Genérico por produto — o HM vai precisar da mesma coisa.

create table if not exists cs.hotmart_identidade (
  produto       text not null,
  email         text not null,
  documento     text,
  pessoa_chave  text not null,
  calculado_em  timestamptz not null default now(),
  primary key (produto, email)
);

comment on table cs.hotmart_identidade is
  '0251: a identidade da pessoa na conciliacao da Hotmart, como COMPONENTE CONEXO do grafo e-mail x documento. Nem e-mail nem CPF servem sozinhos: casar so por e-mail escondia 6 pagantes do AURUM cadastrados com outro endereco; casar so por documento separava 5 que compraram um ciclo como PF e o seguinte pelo CNPJ do proprio escritorio. Recalculada por cs.fn_hotmart_recalcula_identidade.';
comment on column cs.hotmart_identidade.pessoa_chave is
  'Rotulo canonico do componente: o menor documento do grupo, ou "email:<endereco>" quando o grupo nao tem documento algum.';

create index if not exists hotmart_identidade_chave_ix on cs.hotmart_identidade (produto, pessoa_chave);
create index if not exists hotmart_identidade_doc_ix   on cs.hotmart_identidade (produto, documento);

-- ---------------------------------------------------------------------------------------
-- O fechamento transitivo, por propagação de rótulo.
-- ---------------------------------------------------------------------------------------
create or replace function cs.fn_hotmart_recalcula_identidade(p_produto text)
returns int language plpgsql as $$
declare
  v_rodada int := 0;
  v_mudou  bigint;
  v_n      int;
begin
  create temporary table _ident (
    email text primary key,
    doc   text,
    rot   text
  ) on commit drop;

  -- nó inicial: cada e-mail começa com o menor documento que ele já usou; sem documento,
  -- o rótulo é o próprio e-mail
  insert into _ident (email, doc, rot)
  select lower(hp.email),
         min(nullif(regexp_replace(coalesce(hp.documento,''), '\D', '', 'g'), '')),
         coalesce(min(nullif(regexp_replace(coalesce(hp.documento,''), '\D', '', 'g'), '')),
                  'email:' || lower(hp.email))
    from cs.hotmart_pessoa hp
   where hp.produto = p_produto
   group by lower(hp.email);

  -- todos os pares (e-mail, documento) que aparecem em alguma transação são arestas
  create temporary table _aresta as
  select distinct lower(hp.email) as email,
         nullif(regexp_replace(coalesce(hp.documento,''), '\D', '', 'g'), '') as doc
    from cs.hotmart_pessoa hp
   where hp.produto = p_produto
     and nullif(regexp_replace(coalesce(hp.documento,''), '\D', '', 'g'), '') is not null;

  loop
    v_rodada := v_rodada + 1;
    if v_rodada > 20 then
      raise exception '0251: a propagacao de rotulo nao convergiu em 20 rodadas para o produto %. Nada gravado.', p_produto;
    end if;

    -- o menor rótulo entre todos os e-mails que compartilham um documento vence,
    -- e volta para todos os e-mails ligados a esse documento
    with rot_do_doc as (
      select a.doc, min(i.rot) as rot
        from _aresta a join _ident i on i.email = a.email
       group by a.doc
    ), novo as (
      select a.email, min(rd.rot) as rot
        from _aresta a join rot_do_doc rd on rd.doc = a.doc
       group by a.email
    )
    update _ident i set rot = n.rot
      from novo n
     where n.email = i.email and n.rot < i.rot;

    get diagnostics v_mudou = row_count;
    exit when v_mudou = 0;
  end loop;

  delete from cs.hotmart_identidade where produto = p_produto;
  insert into cs.hotmart_identidade (produto, email, documento, pessoa_chave)
  select p_produto, email, doc, rot from _ident;
  get diagnostics v_n = row_count;

  drop table _ident;
  drop table _aresta;
  raise notice '0251: identidade de % recalculada — % e-mails, % pessoas, % rodadas.',
    p_produto, v_n,
    (select count(distinct pessoa_chave) from cs.hotmart_identidade where produto = p_produto),
    v_rodada;
  return v_n;
end $$;

comment on function cs.fn_hotmart_recalcula_identidade(text) is
  '0251: recalcula cs.hotmart_identidade para um produto, por propagacao de rotulo ate estabilizar. Chamar depois de todo import novo em cs.hotmart_pessoa. Falha alto se nao convergir em 20 rodadas — resultado parcial seria pior que erro.';

select cs.fn_hotmart_recalcula_identidade('Aurum');

-- ---------------------------------------------------------------------------------------
-- A conciliação e a Central passam a usar a identidade.
-- ---------------------------------------------------------------------------------------
drop table if exists cs._0251_miolo;
create table cs._0251_miolo (def text);

do $$
declare v_def text; v_miolo text;
begin
  select rtrim(btrim(pg_get_viewdef('cs.vw_central_alunos'::regclass, true)), ';') into v_def;
  if position('aurum_ciclo' in v_def) > 0 then
    v_miolo := cs.fn_desembrulha_camada_0250(v_def);
    if v_miolo is null or position('programa_falta' in v_miolo) = 0
       or position('aurum_ciclo' in v_miolo) > 0 then
      raise exception '0251: nao consegui desembrulhar a camada do AURUM com seguranca — nada foi alterado.';
    end if;
  else
    v_miolo := v_def;
  end if;
  insert into cs._0251_miolo values (v_miolo);
  execute 'drop view cs.vw_central_alunos';
end $$;

drop view if exists cs.vw_aurum_conciliacao;

create view cs.vw_aurum_conciliacao as
with chaveado as (
  select hp.*, id.pessoa_chave as chave
    from cs.hotmart_pessoa hp
    join cs.hotmart_identidade id
      on id.produto = hp.produto and id.email = lower(hp.email)
   where hp.produto = 'Aurum'
), por_ciclo as (
  -- a mesma pessoa, no mesmo ciclo, por dois e-mails ou dois documentos: soma, não duplica
  select chave, ciclo,
         sum(total_contrato)   as contrato_ciclo,
         sum(total_bruto)      as bruto_ciclo,
         sum(n_transacoes)     as tx_ciclo,
         max(pacote_declarado) as pacote_ciclo,
         min(primeiro_pago_em) as ini_ciclo,
         max(ultimo_pago_em)   as fim_ciclo,
         string_agg(distinct ofertas, ';')  as ofertas_ciclo
    from chaveado group by 1, 2
), corrente as (
  select distinct on (chave) * from por_ciclo order by chave, fim_ciclo desc, contrato_ciclo desc
), quem as (
  select chave,
         (array_agg(nome_hotmart order by ultimo_pago_em desc))[1]              as nome_hotmart,
         string_agg(distinct lower(email), ' · ' order by lower(email))         as emails_hotmart,
         count(distinct lower(email))                                          as n_emails,
         string_agg(distinct nullif(regexp_replace(coalesce(documento,''),'\D','','g'),''),
                    ' · ')                                                     as documentos,
         max(export_em)                                                        as export_em
    from chaveado group by 1
), historico as (
  select chave, count(*) as ciclos, sum(tx_ciclo) as tx_total,
         sum(contrato_ciclo) as contrato_total, sum(bruto_ciclo) as bruto_total,
         min(ini_ciclo) as desde,
         string_agg(distinct ciclo, ' · ' order by ciclo) as ciclos_lista
    from por_ciclo group by 1
)
select c.chave                       as pessoa_chave,
       q.nome_hotmart,
       q.emails_hotmart,
       q.n_emails > 1                as paga_com_mais_de_um_email,
       q.documentos,
       c.ciclo                       as ciclo_corrente,
       c.contrato_ciclo              as ciclo_contratado,
       c.bruto_ciclo                 as ciclo_pago_no_cartao,
       c.pacote_ciclo                as ciclo_pacote,
       case when c.pacote_ciclo is not null
            then round(c.pacote_ciclo - c.contrato_ciclo, 2) end as ciclo_falta,
       case
         when c.pacote_ciclo is null                          then 'sem pacote declarado'
         when c.pacote_ciclo - c.contrato_ciclo >  1          then 'devendo'
         when c.pacote_ciclo - c.contrato_ciclo < -1          then 'pagou acima do pacote'
         else 'quitado'
       end                           as ciclo_situacao,
       c.ini_ciclo                   as primeiro_pago_em,
       c.fim_ciclo                   as ultimo_pago_em,
       c.ofertas_ciclo               as ofertas,
       h.ciclos, h.ciclos_lista, h.tx_total, h.contrato_total, h.bruto_total, h.desde,
       q.export_em
  from corrente c
  join quem      q using (chave)
  join historico h using (chave);

comment on view cs.vw_aurum_conciliacao is
  '0251: o financeiro do AURUM por PESSOA, identificada pelo componente conexo e-mail x documento (cs.hotmart_identidade). O ciclo CORRENTE e o mais recente; o historico soma todos — nunca some ciclo_contratado com contrato_total, porque quem renova paga o pacote de novo.';

do $$
declare v_def text;
begin
  select def into v_def from cs._0251_miolo limit 1;
  if v_def is null then
    raise exception '0251: o miolo da Central se perdeu — nada recolado.';
  end if;
  execute format($sql$
    create view cs.vw_central_alunos as
    select b.*,
           au.ciclo_corrente     as aurum_ciclo,
           au.ciclo_situacao     as aurum_situacao,
           au.ciclo_pacote       as aurum_pacote,
           au.ciclo_contratado   as aurum_contratado,
           au.ciclo_falta        as aurum_falta,
           au.contrato_total     as aurum_pago_historico,
           au.ciclos             as aurum_ciclos,
           au.ultimo_pago_em     as aurum_ultimo_pagamento,
           au.emails_hotmart     as aurum_emails_na_hotmart
      from ( %s ) b
      left join lateral (
        -- casa pela TABELA de identidade, que e indexada e ja resolveu o componente conexo:
        -- documento ou e-mail levam a mesma pessoa_chave, entao qualquer um dos dois serve
        -- e nao ha desempate a fazer. Comparar com LIKE sobre a lista concatenada seria
        -- fragil (um CPF pode ser substring de um CNPJ) e nao usaria indice.
        select a.*
          from cs.hotmart_identidade id
          join cs.vw_aurum_conciliacao a on a.pessoa_chave = id.pessoa_chave
         where id.produto = 'Aurum'
           and ( id.documento = nullif(regexp_replace(coalesce(b.documento,''), '\D', '', 'g'), '')
                 or id.email = lower(b.email) )
         limit 1
      ) au on true
  $sql$, v_def);
end $$;

drop table if exists cs._0251_miolo;

do $$
declare v_p int; v_v int; v_s int; v_r numeric;
begin
  select count(*) into v_p from cs.vw_aurum_conciliacao;
  select count(*) filter (where aurum_ciclo is not null) into v_v from cs.vw_central_alunos;
  select count(*), coalesce(sum(contrato_total),0) into v_s, v_r
    from cs.vw_aurum_conciliacao au
   where not exists (
     select 1
       from cs.hotmart_identidade id
       join public.thb_alunos a
         on a.cancelado_em is null
        and ( id.documento = nullif(regexp_replace(coalesce(a.documento,''),'\D','','g'),'')
              or id.email = lower(a.email) )
      where id.produto = 'Aurum' and id.pessoa_chave = au.pessoa_chave);
  raise notice '0251: % pessoas pagaram AURUM · % linhas da Central com o financeiro · % sem cadastro (R$ %).',
    v_p, v_v, v_s, round(v_r,2);
end $$;
