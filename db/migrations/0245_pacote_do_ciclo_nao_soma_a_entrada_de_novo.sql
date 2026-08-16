-- 0245_pacote_do_ciclo_nao_soma_a_entrada_de_novo.sql
-- `pacote_efetivo` (0244) somava a entrada ao pacote da regra — e a entrada JÁ está dentro
-- dele. O programa custa R$ 15.000 no total: R$ 300 (ou R$ 697) de entrada + o saldo.
-- `cs.vw_hm_financeiro.pacote_regra` já é "quanto esta pessoa paga neste ciclo" (15.000
-- menos o crédito pró-rata de quem veio de turma anterior), e `saldo_a_perseguir` é esse
-- pacote menos o que ela já pagou no ciclo — entrada inclusa.
--
-- Somando de novo, 154 das 242 linhas paravam de fechar a conta mais básica que existe:
--
--     pacote = pago no ciclo + falta
--
-- e a planilha mostrava R$ 15.300 onde a operação fala R$ 15.000. Depois da correção a
-- identidade fecha em 237 das 242 — as 5 restantes são casos reais, não erro de fórmula:
-- gente que pagou a mais (Guilherme Canal R$ 10.752,06, Quelen Soper R$ 4.700, Laura
-- Cardoso e Naiara Dias R$ 300 cada) e uma conta que o sistema dá como quitada devendo
-- ~R$ 3.939 (Pedro Henrique Simões). Todas saem nominais na aba "Conferir" da planilha e na
-- tarja vermelha da tela /hm/carteira.
--
-- POR QUE POR REESCRITA, E NÃO RECOLANDO A VIEW
-- A mudança é de UMA expressão. Recolar 200 linhas para trocar 20 caracteres é a receita
-- para introduzir uma diferença que ninguém revisa — então esta migration lê a definição
-- vigente (`pg_get_viewdef`), troca só o trecho, e recria. Se a expressão não estiver lá do
-- jeito esperado, ela FALHA em vez de aplicar meio certo.
do $$
declare
  v_def   text;
  v_velho text := 'COALESCE(f.pacote_cravado, f.pacote_regra + COALESCE(si.valor, 0::numeric))';
  v_novo  text := 'COALESCE(f.pacote_cravado, f.pacote_regra)';
begin
  select pg_get_viewdef('cs.vw_hm_carteira'::regclass, true) into v_def;

  if position(v_velho in v_def) = 0 then
    raise exception '0245: a expressao de pacote_efetivo mudou de forma desde a 0244 — conferir a definicao da view antes de aplicar.';
  end if;

  v_def := replace(v_def, v_velho, v_novo);
  execute 'create or replace view cs.vw_hm_carteira as ' || v_def;

  raise notice '0245: pacote_efetivo passa a ser o pacote do ciclo, sem somar a entrada.';
end $$;

-- Conferência: a identidade tem de fechar na quase totalidade das linhas. Se muitas ficarem
-- de fora, alguma outra coisa mudou e é melhor parar aqui.
do $$
declare v_fecha int; v_nao int;
begin
  select count(*) filter (where abs(coalesce(pacote_efetivo,0) - (coalesce(pago_no_ciclo,0) + coalesce(falta_pagar,0))) <= 1),
         count(*) filter (where abs(coalesce(pacote_efetivo,0) - (coalesce(pago_no_ciclo,0) + coalesce(falta_pagar,0))) >  1)
    into v_fecha, v_nao
    from cs.vw_hm_carteira where produto = 'HM' and pagou_entrada_do_programa;

  raise notice '0245: identidade pacote = pago + falta fecha em % linhas; % ficam para conferencia humana.', v_fecha, v_nao;

  if v_nao > 10 then
    raise exception '0245: % linhas fora da identidade (esperado ~5). Algo mais mudou.', v_nao;
  end if;
end $$;
