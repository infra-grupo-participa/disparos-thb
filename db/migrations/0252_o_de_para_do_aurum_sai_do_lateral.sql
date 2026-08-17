-- 0252_o_de_para_do_aurum_sai_do_lateral.sql
--
-- Correção de desempenho da 0251, não de número.
--
-- A 0251 casou a Central com a conciliação do AURUM por `left join lateral`. Funciona, mas o
-- lateral é reavaliado **uma vez por linha da Central** — 1.808 execuções da conciliação
-- inteira por consulta. Medido: a Central saiu de 0,84 s para 2,3 s quente (6,5 s fria).
--
-- Uma tela de 2 segundos é uma tela que ninguém abre duas vezes. E o custo não vem do
-- AURUM ser caro: `cs.vw_aurum_conciliacao` sozinha responde em ~0,2 s. Vem de ser executada
-- 1.808 vezes.
--
-- A correção é resolver o de-para `aluno → pessoa do AURUM` UMA vez, numa view própria, e a
-- Central passar a fazer um join comum por `aluno_id` — que o planner resolve com hash.
--
-- Continua não fazendo: não atribui turma, não concede acesso, não cria card na Ativação.
--
-- ⚠️ O outro gargalo da Central NÃO é este e não é tocado aqui: o join com
-- `cs.vw_hm_carteira` faz um Nested Loop que descarta 437.298 linhas por consulta, e dentro
-- da própria carteira há um Seq Scan em `contatos_hm` repetido 242 vezes. É defeito das
-- 0240–0246 e será tratado na volta ao HM.
create or replace view cs.vw_aurum_por_aluno as
select distinct on (a.id)
       a.id as aluno_id,
       c.*
  from public.thb_alunos a
  join cs.hotmart_identidade id
    on id.produto = 'Aurum'
   and ( id.documento = nullif(regexp_replace(coalesce(a.documento,''), '\D', '', 'g'), '')
         or id.email = lower(a.email) )
  join cs.vw_aurum_conciliacao c on c.pessoa_chave = id.pessoa_chave
 where a.cancelado_em is null
 order by a.id, c.ultimo_pago_em desc;

comment on view cs.vw_aurum_por_aluno is
  '0252: de-para pronto entre o cadastro (public.thb_alunos.id) e a pessoa do AURUM (cs.vw_aurum_conciliacao), resolvendo documento ou e-mail pela identidade da 0251. Existe para a Central fazer um join comum por aluno_id em vez de um LATERAL reavaliado 1.808 vezes por consulta.';

-- Recola a camada do AURUM na Central usando o de-para.
drop table if exists cs._0252_miolo;
create table cs._0252_miolo (def text);

do $$
declare v_def text; v_miolo text;
begin
  select rtrim(btrim(pg_get_viewdef('cs.vw_central_alunos'::regclass, true)), ';') into v_def;
  if position('aurum_ciclo' in v_def) > 0 then
    v_miolo := cs.fn_desembrulha_camada_0250(v_def);
    if v_miolo is null or position('programa_falta' in v_miolo) = 0
       or position('aurum_ciclo' in v_miolo) > 0 then
      raise exception '0252: nao consegui desembrulhar a camada do AURUM com seguranca — nada foi alterado.';
    end if;
  else
    v_miolo := v_def;
  end if;
  insert into cs._0252_miolo values (v_miolo);
  execute 'drop view cs.vw_central_alunos';
end $$;

do $$
declare v_def text;
begin
  select def into v_def from cs._0252_miolo limit 1;
  if v_def is null then
    raise exception '0252: o miolo da Central se perdeu — nada recolado.';
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
      left join cs.vw_aurum_por_aluno au on au.aluno_id = b.aluno_id
  $sql$, v_def);
end $$;

drop table if exists cs._0252_miolo;

comment on view cs.vw_central_alunos is
  '0239 + 0246 + 0251 + 0252: a Central de Alunos gerada. TRES financeiros distintos, que NAO devem ser somados nem comparados entre si: (a) valor_total/valor_pago/saldo_devedor = CONTRATO DE ACESSO (public.thb_alunos); (b) programa_* = PROGRAMA DE IMPLEMENTACAO do HM (cs.vw_hm_carteira); (c) aurum_* = AURUM (cs.vw_aurum_por_aluno). O AURUM aparece para quem PAGOU, com ou sem turma atribuida.';

do $$
declare v_n int; v_t interval; v_ini timestamptz;
begin
  select count(*) filter (where aurum_ciclo is not null) into v_n from cs.vw_central_alunos;
  v_ini := clock_timestamp();
  perform 1 from (select aluno_id from cs.vw_central_alunos order by nome limit 50) x;
  v_t := clock_timestamp() - v_ini;
  raise notice '0252: % linhas da Central com o financeiro do AURUM · 50 linhas em %.', v_n, v_t;
end $$;
