-- 0236 — "Entrou na esteira HM" → "Entrou na Jornada HM".
--
-- Achado olhando o board no Chromium (13/08): a linha de atividade de QUASE
-- TODA ficha começa com "Entrou na esteira HM". Esteira é palavra nossa, nunca
-- explicada em tela nenhuma, e convive com "Jornada" — que é o nome no menu,
-- no título da página e na tira "Ver como:". Três nomes para a mesma coisa.
--
-- Troca só no GERADOR. O histórico já gravado fica como está: log é o registro
-- do que foi dito na época, não texto de tela para reescrever. As fichas novas
-- nascem certas e as antigas envelhecem.
--
-- Ver docs/plano-sistema-para-quem-opera.md e scripts/test-vocabulario.ts (que
-- trava a palavra no código; o banco não tem como o CI olhar).
do $mig$
declare r record; v_novo text;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='cs' and p.prosrc like '%Entrou na esteira%'
  loop
    v_novo := replace(r.def, 'Entrou na esteira', 'Entrou na Jornada');
    if v_novo <> r.def then execute v_novo; end if;
  end loop;
end $mig$;

do $trava$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='cs' and p.prosrc like '%Entrou na esteira%')
  then raise exception 'ainda ha funcao gerando "Entrou na esteira"'; end if;
end $trava$;
