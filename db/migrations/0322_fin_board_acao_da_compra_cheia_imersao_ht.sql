-- 0322 — o filtro de AÇÃO do board financeiro enxerga a compra cheia (26/09/2026)
--
-- O board do financeiro (grupoparticipa.app.br/relatorios/financeiro) filtra por
-- AÇÃO (acao_nome), e a ação vem de cs.vw_fin_board: o 1º pagamento de SINAL dentro
-- de uma janela de cs.hm_evento_janela. Compra cheia (HM R$ 15 mil, oferta 6fceg8ye
-- da Imersão HT) não tem sinal → caía em "Sem ação identificada".
--
-- Mudança: o pagamento de entrada passa a ser sinal OU compra_cheia, com o SINAL
-- tendo prioridade (ordem `categoria = 'sinal' desc`). Medido antes de aplicar:
-- 0 cards existentes mudam de ação (a versão sem prioridade tirava a ação de 3).
-- Contagem por ação idêntica antes e depois: (sem) 100 · HT ATM T39 85 · Captação
-- T40 43 · Ex aluno T39 39 · ETHB SP 34 · Lançamento T39 11. Grants preservados.
--
-- Janela nova: "Imersão HT - 26-09" (ação "Imersão HT — 26 e 27/09/2026"), de
-- 26/09 00:00 BRT a 01/01/2027 (placeholder: o João quer toda compra de 15k depois
-- do evento neste funil; a próxima ação com janela precisa encurtar esta — 1 UPDATE).
-- APLICADO no banco em 26/09/2026 via MCP; arquivo idempotente.
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_viewdef('cs.vw_fin_board'::regclass);
  if position('compra_cheia' in v_def) > 0 then return; end if;
  v_novo := replace(v_def, $a$WHERE ((p.categoria = 'sinal'::text) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch_1.produto))
          ORDER BY p.comprador_id, ch_1.produto, p.pago_em$a$,
   $b$WHERE ((p.categoria = ANY (ARRAY['sinal'::text, 'compra_cheia'::text])) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch_1.produto))
          ORDER BY p.comprador_id, ch_1.produto, (p.categoria = 'sinal'::text) DESC, p.pago_em$b$);
  if v_novo = v_def then raise exception 'replace nao casou'; end if;
  execute 'create or replace view cs.vw_fin_board as ' || v_novo;
end $$;

insert into cs.hm_evento_janela (canal, inicio, fim, turma, produto, nota)
select 'Imersão HT - 26-09','2026-09-26 03:00+00','2027-01-01 03:00+00','T41','HM','Imersão HT — 26 e 27/09/2026'
where not exists (select 1 from cs.hm_evento_janela where canal = 'Imersão HT - 26-09');
