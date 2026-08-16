-- 0246_central_mostra_os_dois_financeiros.sql
-- A Central passa a mostrar OS DOIS financeiros da pessoa, cada um com o seu nome.
--
-- ⚠️ Depende de `cs.vw_central_alunos`, criada pela 0239 — que está na branch
-- `central-sai-do-banco` (PR #32), ainda não mergeada. Por isso esta migration NÃO recola a
-- definição da view: ela lê a definição vigente (`pg_get_viewdef`), embrulha e acrescenta as
-- colunas novas no fim. Assim as duas branches convergem sem criar duas versões da mesma view.
--
-- O PROBLEMA, medido em 16/08/2026 sobre os 242 do programa:
--   26 pessoas com "valor pago" diferente entre a Central e a Ativação
--   18 pessoas com "saldo" diferente — R$ 205.056,48 somados
--
-- E NENHUM DOS DOIS ESTÁ ERRADO. São contratos diferentes:
--   Central   → public.thb_alunos (planilha de acessos): o CONTRATO DE ACESSO — a turma que
--               a pessoa cursa, quanto pagou por ela, até quando vale
--   Ativação  → cs.hm_pagamentos (o razão): o PROGRAMA DE IMPLEMENTAÇÃO — entrada, saldo,
--               crédito pró-rata
--
-- Exemplo: José Maria Gonçalves aparece "pago 3.997, saldo 0" na Central (a Renovação 2026,
-- que ele quitou) e "pagou 697, falta 12.780,85" na carteira (o programa novo). As duas
-- frases são verdadeiras. Quem abre as duas telas no mesmo dia conclui que o sistema está
-- errado — e foi essa leitura que quase levou um número do contrato errado para a diretoria.
--
-- Igualar os números destruiria informação. A correção é NOMEAR: o que já existia continua
-- sendo o contrato de acesso, e entram seis colunas `programa_*` com o financeiro do HM.
-- Colunas novas entram no FIM (o que `create or replace view` permite), então nenhum
-- consumidor existente quebra.
do $$
declare
  v_def text;
begin
  select rtrim(btrim(pg_get_viewdef('cs.vw_central_alunos'::regclass, true)), ';') into v_def;

  if position('comprador_id' in v_def) = 0 then
    raise exception '0246: cs.vw_central_alunos nao expoe comprador_id — sem ele nao da para casar com o programa.';
  end if;
  if position('programa_falta' in v_def) > 0 then
    raise notice '0246: as colunas do programa ja existem — nada a fazer.';
    return;
  end if;

  execute format($sql$
    create or replace view cs.vw_central_alunos as
    select b.*,
           hm.status            as programa_situacao,
           hm.carteira_nome     as programa_carteira,
           hm.pacote_efetivo    as programa_valor,
           hm.credito_ciclo_anterior as programa_credito,
           hm.pago_no_ciclo     as programa_pago,
           hm.falta_pagar       as programa_falta
      from ( %s ) b
      left join cs.vw_hm_carteira hm
        on hm.comprador_id = b.comprador_id
       and hm.produto = 'HM'
       and hm.pagou_entrada_do_programa
  $sql$, v_def);

  raise notice '0246: Central passa a expor programa_situacao/carteira/valor/credito/pago/falta.';
end $$;

comment on view cs.vw_central_alunos is
  '0239 + 0246: a Central de Alunos gerada. valor_total/valor_pago/saldo_devedor sao o CONTRATO DE ACESSO (public.thb_alunos, planilha de acessos). As colunas programa_* sao o PROGRAMA DE IMPLEMENTACAO (cs.vw_hm_carteira, razao do HM). Sao contratos diferentes e NAO devem ser somados nem comparados entre si: 26 pessoas tinham valor pago diferente e 18 tinham saldo diferente, sem que nenhum dos dois estivesse errado.';

do $$
declare v_n int; v_dois int;
begin
  select count(*), count(*) filter (where programa_falta is not null and saldo_devedor is not null)
    into v_n, v_dois from cs.vw_central_alunos;
  raise notice '0246: % linhas na Central, % com os DOIS financeiros preenchidos.', v_n, v_dois;
end $$;
