-- 0235 — O ALERTA ESCREVIA DINHEIRO EM INGLÊS.
--
-- Achado olhando a tela (13/08), não por teste: o alerta de oferta fora do
-- catálogo mostrava
--
--     "1 compra(s) aprovada(s) somando R$ 1,376.35"
--
-- Isso é mil trezentos e setenta e seis reais escrito à americana. Para quem
-- lê em português é R$ 1,376 — mil trezentos e setenta e seis, sem centavos —
-- ou pior, mil e trezentos e "36". O operador decide cobrança olhando esse
-- número.
--
-- Causa: `to_char(v, 'FM999G999D00')` usa G (separador de milhar) e D
-- (decimal) do lc_numeric do servidor, e o lc_numeric deste banco é
-- en_US.UTF-8 — vírgula no milhar, ponto no decimal. Não é ajustável por
-- sessão de forma confiável (o job roda em outra), então a formatação vira
-- explícita: gera no formato do servidor e troca os dois símbolos.
--
--     translate(to_char(v, 'FM999G999G999D00'), ',.', '.,')  →  1.376,35
--
-- Conferido antes de aplicar:
--     to_char(1376.35,'FM999G999D00')                             → 1,376.35
--     translate(to_char(1376.35,'FM999G999G999D00'), ',.', '.,')  → 1.376,35
--     translate(to_char(59952.04,'FM999G999G999D00'), ',.', '.,') → 59.952,04
-- (o G a mais cobre valores na casa do milhão, que 999G999 truncaria)
--
-- Junto, o resto do vocabulário: "card" continuava em dois textos de alerta.
-- Card é o retângulo na tela; quem opera fala do ALUNO e da FICHA dele. Mesma
-- correção do 0233, que passou batido nestes dois.
-- Ver docs/plano-sistema-para-quem-opera.md.
--
-- Mecânico de propósito: reescreve o corpo atual da função em vez de recolar
-- uma cópia daqui — cópia colada envelhece e desfaz alteração posterior.
-- Idempotente: rodar de novo não acha o que trocar e não muda nada.

do $mig$
declare
  r        record;
  v_novo   text;
  v_trocas int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cs'
       and p.proname in ('fn_hm_alerta_oferta_orfa', 'fn_hm_alerta_oferta_orfa_na_compra')
  loop
    v_novo := r.def;
    v_novo := replace(v_novo,
      $x$to_char(sum(c.preco), 'FM999G999D00')$x$,
      $x$translate(to_char(sum(c.preco), 'FM999G999G999D00'), ',.', '.,')$x$);
    v_novo := replace(v_novo,
      $x$to_char(new.preco, 'FM999G999D00')$x$,
      $x$translate(to_char(new.preco, 'FM999G999G999D00'), ',.', '.,')$x$);
    -- vocabulário
    v_novo := replace(v_novo,
      'o card não nasce e o pagamento não entra no saldo',
      'o aluno não aparece na Jornada e o pagamento não entra no saldo dele');
    v_novo := replace(v_novo,
      'não existe card para ninguém trabalhar',
      'não existe ficha para ninguém trabalhar');

    if v_novo <> r.def then
      execute v_novo;
      v_trocas := v_trocas + 1;
    end if;
  end loop;

  -- fn_hm_alerta_card_faltando também escreve "card", e ela não está no laço
  -- acima porque o nome dela não casa com 'oferta_orfa'.
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cs'
       and p.proname like 'fn_hm_alerta%'
       and p.prosrc like '%não existe card para ninguém trabalhar%'
  loop
    v_novo := replace(r.def,
      'não existe card para ninguém trabalhar',
      'não existe ficha para ninguém trabalhar');
    if v_novo <> r.def then
      execute v_novo;
      v_trocas := v_trocas + 1;
    end if;
  end loop;

  raise notice 'funcoes reescritas: %', v_trocas;
end
$mig$;

-- Os alertas JÁ ABERTOS guardam o texto de quando nasceram: sem isto, a tela
-- segue mostrando "R$ 1,376.35" até alguém resolver o alerta.
update cs.hm_alertas
   set detalhe = replace(
                   replace(
                     regexp_replace(detalhe, 'R\$ (\d{1,3}),(\d{3})\.(\d{2})', 'R$ \1.\2,\3', 'g'),
                     'o card não nasce e o pagamento não entra no saldo',
                     'o aluno não aparece na Jornada e o pagamento não entra no saldo dele'),
                   'não existe card para ninguém trabalhar',
                   'não existe ficha para ninguém trabalhar')
 where resolvido_em is null
   and (detalhe ~ 'R\$ \d{1,3},\d{3}\.\d{2}' or detalhe like '%card%');

-- TRAVA: nenhum alerta aberto pode sair daqui com dinheiro à americana ou com
-- "card" no texto. Se sobrar, a migration falha e nada é aplicado.
do $trava$
declare
  v_ingles int;
  v_jargao int;
begin
  select count(*) into v_ingles
    from cs.hm_alertas
   where resolvido_em is null and detalhe ~ 'R\$ \d{1,3},\d{3}\.\d{2}';
  select count(*) into v_jargao
    from cs.hm_alertas
   where resolvido_em is null and detalhe ilike '%card%';

  if v_ingles > 0 or v_jargao > 0 then
    raise exception 'alertas ainda errados — dinheiro em ingles: %, com "card": %', v_ingles, v_jargao;
  end if;
end
$trava$;
