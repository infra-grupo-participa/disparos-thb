-- 0176_entrada_sem_pacote_tem_onde_aparecer.sql
-- O silêncio novo que a 0174 criou ganha onde aparecer.
--
-- A 0157 documentou o furo clássico: oferta fora do catálogo, venda invisível,
-- ninguém avisa. A 0174 cria um furo IRMÃO e mais discreto: oferta de entrada
-- cadastrada CERTA, mas sem `pacote_cheio`. A venda aparece, o card nasce, e o
-- pacote sai 15.000 pelo fallback histórico — pode estar errado e não há sintoma.
--
-- As exceções não são lista de códigos (isso seria o próximo fóssil): saem dos
-- fatos que já existem — `concede_trilha = false` (é acesso/renovação, não o
-- programa) e produto <> 'HM' em `cs.hm_origem_por_oferta` (é o Aurum, que tem
-- parâmetros próprios).
--
-- Hoje esta view devolve exatamente uma linha: `nz3ob9r2` (R$2.000, 11 vendas,
-- 18/04→17/06), que é o BLOQUEIO B1 — o pacote daquela porta nunca foi decidido
-- pelo Marcio. A view existir é o que mantém essa pendência visível em vez de
-- esquecida.
--
-- FICA COMO VIEW e não como alerta dentro de `cs.fn_hm_health_check` por uma razão
-- de risco: o health check é uma função de 7 mil caracteres e reescrevê-la inteira
-- para acrescentar um bloco, no meio de uma noite de vendas, é trocar um risco
-- pequeno por um grande. A ligação dela ao health check está registrada como
-- tarefa aberta em tmp/squad/saldo-pela-entrada.md.
create or replace view cs.vw_hm_entradas_sem_pacote as
select cat.offer_code                                   as oferta,
       cat.notes                                        as nota,
       count(c.id)                                      as vendas_aprovadas,
       min(coalesce(c.data_aprovacao, c.data_compra))   as primeira_venda,
       max(coalesce(c.data_aprovacao, c.data_compra))   as ultima_venda,
       round(min(c.preco))                              as preco_da_entrada,
       'Sem pacote_cheio: o pacote destes cards sai do fallback historico de 15.000. Definir o preco da porta em public.hm_product_catalog.' as o_que_fazer
  from public.hm_product_catalog cat
  join public.compras c on c.oferta_codigo = cat.offer_code
                       and c.status in ('APPROVED','COMPLETE','COMPLETED')
 where cat.categoria = 'sinal'
   and cat.pacote_cheio is null
   and cat.concede_trilha
   and coalesce((select o.produto from cs.hm_origem_por_oferta o
                  where o.oferta_codigo = cat.offer_code
                  order by o.vale_de desc nulls last limit 1), 'HM') = 'HM'
 group by cat.offer_code, cat.notes;

comment on view cs.vw_hm_entradas_sem_pacote is
  'Portas de entrada do HM cadastradas como sinal e SEM preco de pacote declarado (0176). Cada linha e um grupo de alunos cujo saldo esta saindo do fallback de 15.000 sem que ninguem tenha decidido. Deveria estar sempre vazia.';

grant select on cs.vw_hm_entradas_sem_pacote to disparos_app;
