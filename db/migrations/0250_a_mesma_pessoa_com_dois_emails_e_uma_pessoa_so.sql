-- 0250_a_mesma_pessoa_com_dois_emails_e_uma_pessoa_so.sql
--
-- Correção da 0249, achada na conferência seguinte: ela casava a Central com a Hotmart
-- **só por e-mail**, e e-mail não é identidade.
--
-- O QUE ISSO ESCONDIA (medido em 16/08/2026):
--
--   6 pagantes do AURUM que a 0249 dava como "não está cadastrado no sistema" ESTÃO na
--   base — com outro e-mail. Casam por CPF:
--
--     Leandro Marcantonio  paga como leandro@marcantoniopinotti.com.br,
--                          cadastrado como leandromarcantonio@gmail.com ......... R$ 30.000
--     Rony Jose Morais     rony.morais@outlook.com  ×  rony.morais@chmm.com.br ... R$ 28.000
--     Maria Ap Coelho      advocaciamariacoelho@   ×  maria@advocaciamariacoelho R$ 25.000
--     Raphael Rodrigues    raphaellince1@          ×  linceholdingfamiliar@ ...... R$ 25.000
--     Ana Cláudia Zerger   anaclaudiazer@          ×  anaclaudiazerger@ ...........R$  3.000
--     Swellen Yano         swyano@yahoo.com.br     ×  swellen@yano.adv.br .........R$  1.000
--
--   E, do lado da Hotmart, 3 pessoas pagaram com DOIS e-mails — inclusive um com typo
--   (`lilianzielnski` sem o `i`). Contadas como duas, elas inflavam o universo: são 264
--   pessoas, não 267. Raphael aparecia duas vezes, cada metade num "ciclo" diferente,
--   e nenhuma das duas fechava contra o pacote.
--
-- A CHAVE passa a ser o DOCUMENTO quando ele tem 11 ou 14 dígitos; e-mail só quando não há
-- documento. Conferido antes de aplicar — o risco de juntar gente diferente é conhecido e
-- pequeno: dos documentos do AURUM com mais de um cadastro na base, 4 são duplicata do
-- mesmo nome e 2 são os casos que a 0239 já tinha catalogado (`53646257000181` = Pala Soc /
-- Suely Pala). Juntar o FINANCEIRO deles é correto — é o mesmo dinheiro, do mesmo CPF.
-- O que continua não sendo feito é mesclar cadastro, que é decisão humana.
--
-- Continua valendo o que a 0249 estabeleceu: nada aqui atribui turma, concede acesso ou
-- cria card na Ativação.

-- ---------------------------------------------------------------------------------------
-- Ferramenta: desembrulhar uma camada de view.
--
-- A 0246 e a 0249 embrulham a Central (`select b.*, ... from ( <miolo> ) b`). Para TROCAR a
-- camada do AURUM em vez de empilhar mais uma por cima, é preciso extrair o miolo. Conta
-- parênteses — determinístico. Quem chama valida o que saiu antes de usar.
-- ---------------------------------------------------------------------------------------
create or replace function cs.fn_desembrulha_camada_0250(p_def text)
returns text language plpgsql immutable as $fn$
declare
  i int; ini int; nivel int := 0; ch text;
begin
  ini := position('FROM (' in upper(p_def));
  if ini = 0 then
    return null;
  end if;
  ini := ini + 5;                       -- posiciona no '('
  for i in ini .. length(p_def) loop
    ch := substr(p_def, i, 1);
    if ch = '(' then
      nivel := nivel + 1;
    elsif ch = ')' then
      nivel := nivel - 1;
      if nivel = 0 then
        return btrim(substr(p_def, ini + 1, i - ini - 1));
      end if;
    end if;
  end loop;
  return null;
end $fn$;

comment on function cs.fn_desembrulha_camada_0250(text) is
  '0250: extrai a subquery interna de uma view em camadas (select b.*, ... from ( <miolo> ) b), contando parenteses. Serve para TROCAR uma camada em vez de empilhar outra — sem isso, cada correcao vira mais um nivel de aninhamento sobre cs.vw_central_alunos.';

-- ---------------------------------------------------------------------------------------
-- 0. Desmonta na ordem certa.
--
-- A Central da 0249 depende de `cs.vw_aurum_conciliacao`, e a conciliação nova troca nome e
-- tipo de coluna — `create or replace view` não faz isso. Então: guarda o miolo da Central,
-- derruba a camada do AURUM, troca a conciliação, e recola no fim. Sem `cascade` em lugar
-- nenhum: se algo mais depender da Central, o drop falha e a migration para, que é o
-- comportamento certo.
--
-- O miolo fica numa tabela de apoio REAL (não temporária) porque cada statement pode rodar
-- em transação própria — uma temp com `on commit drop` sumiria entre um bloco e o outro.
-- Ela é derrubada no fim da migration.
-- ---------------------------------------------------------------------------------------
drop table if exists cs._0250_miolo;
create table cs._0250_miolo (def text);

do $$
declare v_def text; v_miolo text;
begin
  if to_regclass('cs.vw_central_alunos') is null then
    raise exception '0250: cs.vw_central_alunos nao existe — rode a 0239 antes.';
  end if;
  select rtrim(btrim(pg_get_viewdef('cs.vw_central_alunos'::regclass, true)), ';') into v_def;

  if position('aurum_ciclo' in v_def) > 0 then
    v_miolo := cs.fn_desembrulha_camada_0250(v_def);
    if v_miolo is null or position('programa_falta' in v_miolo) = 0 then
      raise exception '0250: nao consegui desembrulhar a camada do AURUM com seguranca — nada foi alterado.';
    end if;
    if position('aurum_ciclo' in v_miolo) > 0 then
      raise exception '0250: o miolo ainda contem aurum_ciclo — ha mais de uma camada empilhada. Abortado.';
    end if;
  else
    v_miolo := v_def;   -- 0249 nao chegou a ser aplicada nesta base
  end if;

  insert into cs._0250_miolo values (v_miolo);
  execute 'drop view cs.vw_central_alunos';
  raise notice '0250: Central derrubada para troca de camada (miolo guardado, % caracteres).', length(v_miolo);
end $$;

drop view if exists cs.vw_aurum_conciliacao;

-- ---------------------------------------------------------------------------------------
-- 1. A conciliação passa a ser por PESSOA (documento), não por caixa de e-mail.
-- ---------------------------------------------------------------------------------------
create view cs.vw_aurum_conciliacao as
with marcado as (
  select hp.*,
         nullif(regexp_replace(coalesce(hp.documento,''), '\D', '', 'g'), '') as doc_num
    from cs.hotmart_pessoa hp
   where hp.produto = 'Aurum'
), chaveado as (
  select m.*,
         case when length(m.doc_num) in (11, 14) then 'doc:' || m.doc_num
              else 'email:' || lower(m.email) end as chave
    from marcado m
), corrente as (
  select distinct on (chave)
         chave, lower(email) as email, nome_hotmart, doc_num, ciclo,
         total_contrato, total_bruto, pacote_declarado,
         primeiro_pago_em, ultimo_pago_em, ofertas, export_em
    from chaveado
   order by chave, ultimo_pago_em desc, total_contrato desc
), por_ciclo as (
  -- a MESMA pessoa com dois e-mails no mesmo ciclo tem de somar, não duplicar
  select chave, ciclo,
         sum(total_contrato) as contrato_ciclo,
         sum(total_bruto)    as bruto_ciclo,
         sum(n_transacoes)   as tx_ciclo,
         max(pacote_declarado) as pacote_ciclo,
         max(ultimo_pago_em)   as fim_ciclo
    from chaveado group by 1, 2
), historico as (
  select chave,
         count(*)                                          as ciclos,
         sum(tx_ciclo)                                     as tx_total,
         sum(contrato_ciclo)                               as contrato_total,
         sum(bruto_ciclo)                                  as bruto_total,
         string_agg(distinct ciclo, ' · ' order by ciclo)  as ciclos_lista
    from por_ciclo group by 1
), emails as (
  select chave, string_agg(distinct lower(email), ' · ' order by lower(email)) as emails_hotmart,
         count(distinct lower(email)) as n_emails
    from chaveado group by 1
)
select c.chave,
       c.email,
       e.emails_hotmart,
       e.n_emails > 1                as paga_com_mais_de_um_email,
       c.nome_hotmart,
       c.doc_num                     as documento,
       c.ciclo                       as ciclo_corrente,
       pc.contrato_ciclo             as ciclo_contratado,
       pc.bruto_ciclo                as ciclo_pago_no_cartao,
       pc.pacote_ciclo               as ciclo_pacote,
       case when pc.pacote_ciclo is not null
            then round(pc.pacote_ciclo - pc.contrato_ciclo, 2) end as ciclo_falta,
       case
         when pc.pacote_ciclo is null                            then 'sem pacote declarado'
         when pc.pacote_ciclo - pc.contrato_ciclo >  1           then 'devendo'
         when pc.pacote_ciclo - pc.contrato_ciclo < -1           then 'pagou acima do pacote'
         else 'quitado'
       end                           as ciclo_situacao,
       c.primeiro_pago_em, c.ultimo_pago_em, c.ofertas,
       h.ciclos, h.ciclos_lista, h.tx_total, h.contrato_total, h.bruto_total,
       c.export_em
  from corrente c
  join historico h using (chave)
  join emails    e using (chave)
  join por_ciclo pc on pc.chave = c.chave and pc.ciclo = c.ciclo;

comment on view cs.vw_aurum_conciliacao is
  '0249 + 0250: o financeiro do AURUM por PESSOA (documento quando tem 11/14 digitos, e-mail so na falta dele), a partir do retrato da Hotmart. Casar so por e-mail escondia 6 pagantes que existem na base com outro endereco e contava 3 pessoas em dobro. O ciclo CORRENTE e o mais recente; o historico soma todos — nunca some ciclo_contratado com contrato_total, porque quem renova paga o pacote de novo.';

-- ---------------------------------------------------------------------------------------
-- 2. O join da Central passa a tentar DOCUMENTO primeiro, e-mail como segunda via.
-- ---------------------------------------------------------------------------------------
do $$
declare v_def text;
begin
  select def into v_def from cs._0250_miolo limit 1;
  if v_def is null then
    raise exception '0250: o miolo da Central se perdeu entre os blocos — nada recolado.';
  end if;

  execute format($sql$
    create view cs.vw_central_alunos as
    select b.*,
           au.ciclo_corrente            as aurum_ciclo,
           au.ciclo_situacao            as aurum_situacao,
           au.ciclo_pacote              as aurum_pacote,
           au.ciclo_contratado          as aurum_contratado,
           au.ciclo_falta               as aurum_falta,
           au.contrato_total            as aurum_pago_historico,
           au.ciclos                    as aurum_ciclos,
           au.ultimo_pago_em            as aurum_ultimo_pagamento,
           au.emails_hotmart            as aurum_emails_na_hotmart
      from ( %s ) b
      left join lateral (
        -- documento vale mais que e-mail: `prio` decide, e o ORDER BY torna a escolha
        -- determinística (UNION ALL sozinho não garante ordem de leitura)
        select a.*, 1 as prio
          from cs.vw_aurum_conciliacao a
         where a.documento is not null
           and a.documento = nullif(regexp_replace(coalesce(b.documento,''), '\D', '', 'g'), '')
         union all
        select a.*, 2 as prio
          from cs.vw_aurum_conciliacao a
         where a.email = lower(b.email)
         order by prio, ultimo_pago_em desc
         limit 1
      ) au on true
  $sql$, v_def);

  raise notice '0250: Central casa o AURUM por documento, com e-mail de segunda via.';
end $$;

comment on view cs.vw_central_alunos is
  '0239 + 0246 + 0250: a Central de Alunos gerada. TRES financeiros distintos, que NAO devem ser somados nem comparados entre si: (a) valor_total/valor_pago/saldo_devedor = CONTRATO DE ACESSO (public.thb_alunos); (b) programa_* = PROGRAMA DE IMPLEMENTACAO do HM (cs.vw_hm_carteira); (c) aurum_* = AURUM (cs.vw_aurum_conciliacao, retrato da Hotmart). O AURUM casa por DOCUMENTO, com e-mail de segunda via: casar so por e-mail escondia 6 pagantes cadastrados com outro endereco.';

do $$
declare v_p int; v_v int; v_semcad int; v_r numeric;
begin
  select count(*) into v_p from cs.vw_aurum_conciliacao;
  select count(*) filter (where aurum_ciclo is not null) into v_v from cs.vw_central_alunos;
  select count(*), coalesce(sum(contrato_total),0) into v_semcad, v_r
    from cs.vw_aurum_conciliacao au
   where not exists (
     select 1 from public.thb_alunos a
      where a.cancelado_em is null
        and (nullif(regexp_replace(coalesce(a.documento,''),'\D','','g'),'') = au.documento
             or lower(a.email) = au.email));
  raise notice '0250: % pessoas pagaram AURUM · % linhas da Central com o financeiro · % sem cadastro (R$ %).',
    v_p, v_v, v_semcad, round(v_r,2);
end $$;

drop table if exists cs._0250_miolo;
