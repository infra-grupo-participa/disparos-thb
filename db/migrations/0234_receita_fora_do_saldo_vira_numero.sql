-- 0234 — 27 ALERTAS QUE NINGUÉM PODIA RESOLVER VIRARAM UM NÚMERO.
--
-- Pedido do Marcio, direto: "tira esses 27 aviso e me avisa quando terminar".
--
-- O que eram: o 0230 criou `fn_hm_alerta_compra_fora_do_razao()`, que abria um
-- alerta por compra aprovada numa categoria que NÃO abate o pacote de 15k
-- (renovação, reserva). Isso não é defeito — é assim de propósito, senão o
-- sistema marcaria como quitado quem não pagou o pacote. O alerta existia só
-- para o dinheiro ser visível, porque até a auditoria de 12/08 essa receita não
-- aparecia em lugar nenhum: nem no saldo, nem na Jornada, nem no export.
--
-- Por que sai: alerta é uma FILA DE TRABALHO. Cada linha ali é uma coisa que
-- alguém tem de ir fazer. Estas 27 não tinham o que fazer — davam "Resolvido"
-- e voltavam no dia seguinte, porque a compra continua lá. Vinte e sete linhas
-- que não pedem ação empurram para baixo as 3 que pedem, e treinam o time a
-- fechar tudo sem ler. Foi exatamente assim que os 13 falsos "Reclamada" do
-- 0208 quase fizeram passar batido um reembolso de verdade.
--
-- O dinheiro NÃO some da vista: a mesma consulta virou função de leitura e a
-- tela mostra uma linha — "27 compras, R$ 59.952,04 desde 25/06" — no lugar de
-- 27 avisos vermelhos. Número é informação; alerta é tarefa. Não é a mesma
-- coisa e não pode morar no mesmo lugar.
--
-- Medido depois de aplicar: alertas abertos 105 → 78 (3 críticos + 75 avisos).

-- 1. A fonte para. Sem isto o job reabre as 27 na próxima varredura.
drop function if exists cs.fn_hm_alerta_compra_fora_do_razao();

-- 2. As abertas saem da fila. Só as deste tipo — nada mais é tocado.
delete from cs.hm_alertas
 where tipo = 'compra_fora_do_razao'
   and resolvido_em is null;

-- 3. A MESMA consulta, agora como leitura. Um número na tela de Saúde do
--    dinheiro. `desde` existe para o número ter janela: "R$ 59.952,04" sem
--    período não quer dizer nada.
--    O corte em 25/06 é o início da operação do sistema (mesma data usada em
--    0230); antes disso a receita foi reconhecida fora daqui.
--    `not exists em hm_pagamentos` garante que não conta duas vezes o que já
--    entrou no saldo por outro caminho.
create or replace function cs.fn_hm_receita_fora_do_saldo()
returns table(compras integer, total numeric, desde date)
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select count(*)::int,
         coalesce(sum(c.preco), 0),
         min(coalesce(c.data_aprovacao, c.data_compra, c.criado_em))::date
    from public.compras c
    join public.hm_product_catalog k on k.offer_code = c.oferta_codigo
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and k.categoria not in ('sinal','diferenca','compra_cheia')
     and coalesce(c.preco, 0) > 0
     and coalesce(c.data_aprovacao, c.data_compra, c.criado_em) >= '2026-06-25'
     and not exists (select 1 from cs.hm_pagamentos p where p.compra_id = c.id);
$fn$;

grant execute on function cs.fn_hm_receita_fora_do_saldo() to disparos_app;

-- TRAVA: o dinheiro tem de continuar visível. Se a função devolver zero compra,
-- alguma coisa quebrou na troca (join, categoria, corte de data) e o valor
-- sumiu da vista em vez de mudar de lugar — que é justamente o risco desta
-- migration. Falha aqui em vez de silenciar R$ 59 mil.
do $trava$
declare v_n int; v_total numeric;
begin
  select compras, total into v_n, v_total from cs.fn_hm_receita_fora_do_saldo();
  if coalesce(v_n, 0) = 0 then
    raise exception 'a receita fora do saldo sumiu da leitura — nao era para zerar';
  end if;
  raise notice 'receita fora do saldo: % compras, R$ %', v_n, v_total;

  if exists (select 1 from cs.hm_alertas
              where tipo = 'compra_fora_do_razao' and resolvido_em is null) then
    raise exception 'ainda ha alerta compra_fora_do_razao aberto';
  end if;
end
$trava$;
