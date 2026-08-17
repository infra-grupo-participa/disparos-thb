-- 0254_a_central_tambem_diz_por_que_nao_e_15_mil.sql
--
-- A explicação criada na 0253 chega à Central.
--
-- A carteira do comercial passou a responder "por que essa pessoa não paga R$ 15.000", mas a
-- Central — que é a tela em que a diretoria abre o aluno — continuava mostrando só
-- `programa_valor` e `programa_falta`, sem dizer de onde saiu o desconto. Quem visse
-- "pacote R$ 5.268,49" ali não tinha como saber se foi acordo comercial, crédito de ciclo
-- anterior ou erro do sistema — e é exatamente essa dúvida que faz alguém pedir para
-- "conferir tudo de novo".
--
-- Entram três colunas no fim: `programa_pacote_base`, `programa_abatimento` e
-- `programa_explicacao`. Nenhuma coluna existente muda de nome, tipo ou posição.
--
-- Como a Central é montada em camadas (0246 programa · 0252 AURUM), a camada do AURUM é
-- desembrulhada e recolada junto — do contrário cada correção viraria mais um nível de
-- aninhamento sobre a mesma view.
drop table if exists cs._0254_miolo;
create table cs._0254_miolo (def text);

do $$
declare v_def text; v_miolo text;
begin
  select rtrim(btrim(pg_get_viewdef('cs.vw_central_alunos'::regclass, true)), ';') into v_def;
  if position('aurum_ciclo' in v_def) > 0 then
    v_miolo := cs.fn_desembrulha_camada_0250(v_def);
    if v_miolo is null or position('programa_falta' in v_miolo) = 0 then
      raise exception '0254: nao consegui desembrulhar a camada do AURUM — nada alterado.';
    end if;
  else
    v_miolo := v_def;
  end if;
  insert into cs._0254_miolo values (v_miolo);
  execute 'drop view cs.vw_central_alunos';
end $$;

do $$
declare v_def text;
begin
  select def into v_def from cs._0254_miolo limit 1;
  if v_def is null then
    raise exception '0254: o miolo da Central se perdeu — nada recolado.';
  end if;
  execute format($sql$
    create view cs.vw_central_alunos as
    select b.*,
           hm2.pacote_base          as programa_pacote_base,
           hm2.abatimento_total     as programa_abatimento,
           hm2.explicacao_do_valor  as programa_explicacao,
           au.ciclo_corrente        as aurum_ciclo,
           au.ciclo_situacao        as aurum_situacao,
           au.ciclo_pacote          as aurum_pacote,
           au.ciclo_contratado      as aurum_contratado,
           au.ciclo_falta           as aurum_falta,
           au.contrato_total        as aurum_pago_historico,
           au.ciclos                as aurum_ciclos,
           au.ultimo_pago_em        as aurum_ultimo_pagamento,
           au.emails_hotmart        as aurum_emails_na_hotmart
      from ( %s ) b
      left join cs.vw_hm_carteira hm2
        on hm2.comprador_id = b.comprador_id
       and hm2.produto = 'HM'
       and hm2.pagou_entrada_do_programa
      left join cs.vw_aurum_por_aluno au on au.aluno_id = b.aluno_id
  $sql$, v_def);
end $$;

drop table if exists cs._0254_miolo;

comment on view cs.vw_central_alunos is
  '0239 + 0246 + 0252 + 0254: a Central de Alunos gerada. TRES financeiros distintos, que NAO devem ser somados nem comparados entre si: (a) valor_total/valor_pago/saldo_devedor = CONTRATO DE ACESSO (public.thb_alunos); (b) programa_* = PROGRAMA DE IMPLEMENTACAO do HM, agora com programa_explicacao respondendo "por que nao e 15 mil"; (c) aurum_* = AURUM. O AURUM aparece para quem PAGOU, com ou sem turma atribuida.';

do $$
declare v_n int; v_e int; v_a int;
begin
  select count(*), count(programa_explicacao), count(aurum_ciclo) into v_n, v_e, v_a
    from cs.vw_central_alunos;
  raise notice '0254: % linhas · % com a explicacao do programa · % com o financeiro do AURUM.', v_n, v_e, v_a;
end $$;
