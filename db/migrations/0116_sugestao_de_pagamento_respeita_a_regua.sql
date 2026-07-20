-- =====================================================================
-- 0116_sugestao_de_pagamento_respeita_a_regua
--
-- O COMERCIAL RELATOU PROBLEMA AO SALVAR PAGAMENTO. A causa não era o salvar —
-- era o NÚMERO que o formulário sugeria.
--
-- `fn_hm_sugestao_financeira` devolvia **15.000 cravado** para todo card com
-- `categoria_entrada = 'sinal'`, ignorando o crédito pró-rata. Para o LEAD NOVO
-- isso está certo (o pacote é 15.000 mesmo). Para o ALUNO DA BASE, não: o pacote
-- dele é 15.000 − crédito. Ao confirmar a sugestão, o operador cravava
-- valor_total = 15.000 enquanto o pagamento antigo (que virou o crédito) seguia
-- somado em valor_pago — o mesmo dinheiro contado duas vezes.
--
-- Foi exatamente assim que nasceu o "crédito duplo" da 0112 (Naiara, Pedro,
-- Áurea, Guilherme): saldo zerando por coincidência aritmética e o board pintando
-- de verde quem ainda devia. A 0112 desfez o estrago zerando o valor_total; mas o
-- formulário continuou sugerindo 15.000 — então bastava alguém salvar de novo
-- para recriar tudo. Hoje são **71 cards** nessa condição.
--
-- Correção na ORIGEM: a sugestão passa a ser o pacote da RÉGUA
-- (cs.vw_hm_financeiro.pacote_regra) — 15.000 para lead novo, 15.000 − crédito
-- para aluno da base. Quando a régua não sabe calcular (aluno da base sem os
-- insumos do crédito), cai no comportamento antigo: não há número melhor, e a
-- lente "Sem saldo calculável" já acende esse caso.
--
-- Só leitura de dados; muda apenas o que o formulário PROPÕE. Nada é reescrito.
-- =====================================================================

create or replace function cs.fn_hm_sugestao_financeira(p_comprador_id uuid)
returns table(sugestao_valor_total numeric, hotmart_bruto numeric)
language sql
stable
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select
    coalesce(
      -- O pacote que a régua manda cobrar (já desconta o crédito pró-rata).
      f.pacote_regra,
      -- Fallback: régua incalculável (aluno da base sem insumos do crédito).
      case when ch.categoria_entrada = 'sinal' then 15000::numeric
           else (select coalesce(sum(c.preco), 0)
                   from public.compras c
                   join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
                  where c.comprador_id = ch.comprador_id
                    and c.status in ('APPROVED','COMPLETE','COMPLETED')
                    and cat.categoria = 'compra_cheia')
      end
    ) as sugestao_valor_total,
    (select coalesce(sum(c.preco), 0)
       from public.compras c
       join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      where c.comprador_id = ch.comprador_id
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
        and cat.categoria in ('sinal','compra_cheia','diferenca')) as hotmart_bruto
  from cs.contatos_hm ch
  left join cs.vw_hm_financeiro f on f.comprador_id = ch.comprador_id
  where ch.comprador_id = p_comprador_id;
$function$;

comment on function cs.fn_hm_sugestao_financeira(uuid) is
  'Sugere o pacote pela REGUA (15.000 lead novo; 15.000 - credito para aluno da base). Sugerir 15.000 cravado a quem tem credito foi o que criou o credito duplo (0112).';
