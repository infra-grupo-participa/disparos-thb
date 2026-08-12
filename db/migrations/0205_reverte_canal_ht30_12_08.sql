-- 0205 — REVERTE a 0204. A live de 12/08 NÃO vende a entrada.
--
-- A 0204 criou o canal "HT30 - 12-08" para a oferta `rlgjsrul` (entrada R$697),
-- assumindo que a live de hoje seria mais uma edição do mesmo pitch — como foram
-- as de 09, 10 e 11/08. Premissa errada.
--
-- CORREÇÃO DO MARCIO: "hoje não vai ter venda nova, a live de hoje é para as
-- pessoas que pagaram o sinal mas não pagaram o saldo, para convencer eles a
-- como pagar sem perder dinheiro".
--
-- É uma live de RECUPERAÇÃO DE SALDO, não de aquisição. Medido no momento da
-- correção: 199 cards do HM devendo, R$ 2.714.485,15 em aberto
-- (142 saldo parado · 36 parcelando · 7 com oferta enviada · 3 incalculáveis).
--
-- E o saldo NÃO tem oferta única: são 57 códigos individuais em
-- `cs.hm_ofertas_saldo` (categoria 'diferenca'), um por valor devido de cada
-- aluno. Quem pagar hoje usa o link que JÁ é dele — não existe "a oferta da live
-- de hoje" para pendurar num canal.
--
-- Logo, um canal de AQUISIÇÃO apontando para `rlgjsrul` em 12/08 está errado por
-- construção: se alguém comprar a entrada hoje por um link antigo que circulou, a
-- venda seria creditada a uma live que não vendeu entrada — sujando exatamente a
-- régua que os canais existem para manter honesta ("qual live converteu mais?").
--
-- ── O QUE FICA DE LIÇÃO ─────────────────────────────────────────────────────────
-- Canal por edição de live pressupõe que a live VENDE aquela oferta. Antes de
-- criar, perguntar o que a live de hoje vende — não assumir que é a repetição da
-- anterior. Live de recuperação/aquecimento/pós-venda não abre canal de aquisição.
--
-- Conferido antes de reverter: 0 compras de `rlgjsrul` na janela de 12/08 20:00.
-- Nenhum card muda de canal — volta exatamente ao estado anterior à 0204
-- (22 / 18 / 11 em 09-08 / 10-08 / 11-08, conferido depois).
--
-- A janela de 11-08 volta a ficar ABERTA (vale_ate null), que é o padrão: ela
-- cobre o rescaldo até a próxima live que EFETIVAMENTE vender a entrada.

delete from cs.hm_origem_por_oferta
 where oferta_codigo = 'rlgjsrul'
   and origem = 'HT30 - 12-08';

update cs.hm_origem_por_oferta
   set vale_ate = null,
       nota = 'Live do HT de 11/08/2026 (3a edicao do pitch da entrada R$697). '
              'Mesma oferta das lives anteriores na Hotmart: o que separa os canais e a janela de compra. '
              'Sem fim ate a proxima live que VENDER A ENTRADA (0205): a de 12/08 foi de recuperacao de '
              'saldo, nao de aquisicao, entao nao abre canal proprio.'
 where oferta_codigo = 'rlgjsrul'
   and origem = 'HT30 - 11-08';

do $$
declare v_linhas int; v_abertas int;
begin
  select count(*) into v_linhas from cs.hm_origem_por_oferta where oferta_codigo = 'rlgjsrul';
  select count(*) into v_abertas from cs.hm_origem_por_oferta
   where oferta_codigo = 'rlgjsrul' and vale_ate is null;
  if v_linhas <> 3 then
    raise exception '0205: esperava 3 janelas (09-08, 10-08, 11-08), achei %', v_linhas;
  end if;
  if v_abertas <> 1 then
    raise exception '0205: esperava exatamente 1 janela aberta, achei %', v_abertas;
  end if;
  raise notice '0205: revertido — % janelas, a de 11-08 aberta de novo', v_linhas;
end $$;
