-- 0262_as_ofertas_que_o_banco_conhece_e_a_planilha_nao.sql
--
-- Depois de promover a planilha do Marcio (0256/0257), o catálogo foi de 96 para 117 ofertas e
-- ganhou valor de vitrine e link em 57 delas. Sobraram, ainda assim, **16 códigos de oferta que
-- já receberam dinheiro aprovado e não existem no catálogo** — R$ 310.826,67 medidos em produção
-- em 17/08/2026.
--
-- O Marcio avisou: "consegui reunir muitas, não todas". Estas 16 são exatamente as que faltaram —
-- e o sistema já sabia delas o tempo inteiro, porque a compra passou pelo webhook. Enquanto a
-- oferta não existe no catálogo, o dinheiro dela entra sem classificação: sem papel, sem produto,
-- sem valor de tabela, e (para ETHB, Clínica, VIP-HT e Holding Mais) sem nem gerar alerta de
-- oferta órfã, porque o alerta da 0195 só cobre produto presente em cs.hm_produto_hotmart.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION FAZ — E O QUE ELA SE RECUSA A FAZER
--
-- FAZ: cadastra as 16 com o que o BANCO PROVA — offer_code, product_id, product_name (o nome que
-- veio no evento da Hotmart), papel quando o próprio produto o define, e origem_do_dado='webhook'
-- com origem_ref apontando para a evidência (quantas compras, quanto, em que janela).
--
-- NÃO FAZ: não inventa `valor_tabela` e não inventa `link`. O preço PAGO não é o preço de TABELA
-- (tem desconto, cupom, parcela, migração de lote), e a URL de checkout não é derivável do código
-- da oferta. Chutar qualquer um dos dois seria pôr número errado numa tela que o Marcio vai usar
-- para cobrar gente — o oposto do pedido dele. Elas nascem com `valor_tabela` e `link` NULOS, e a
-- tela {base}/ofertas já destaca em âmbar quem está assim: vira lista de trabalho, não mentira.
--
-- NÃO TOCA A RÉGUA: pacote_cheio, entrada_condicao_fechada, entrada_do_programa e concede_trilha
-- ficam como o default da tabela. Nenhuma destas 16 é entrada de programa — são ingresso de
-- evento, produto de outra esteira ou lote antigo. Marcar qualquer uma mudaria dinheiro de gente.
--
-- ---------------------------------------------------------------------------
-- CONTAR ANTES (rodado em 17/08/2026, colar de novo antes de reaplicar):
--
--   with aprovado as (
--     select c.oferta_codigo, min(c.produto_nome) produto, count(*) n, sum(c.preco) soma
--       from public.compras c
--      where c.status in ('APPROVED','COMPLETE','COMPLETED') and c.oferta_codigo is not null
--      group by 1
--   )
--   select count(*) ofertas, sum(a.soma) dinheiro
--     from aprovado a
--     left join public.hm_product_catalog cat on cat.offer_code = a.oferta_codigo
--    where cat.offer_code is null;
--
-- Medido: 16 ofertas · R$ 310.826,67. DEPOIS desta migration: 0 ofertas · R$ 0,00.
-- (As 124 compras de "Holding Total (ingresso)" com `oferta_codigo` NULO continuam fora — não há
-- código para catalogar. Isso é outro problema, do webhook, não do catálogo.)
-- ---------------------------------------------------------------------------

insert into public.hm_product_catalog
  (offer_code, product_id, product_name, nome_comercial, produto_checkout, papel,
   explicacao, origem_do_dado, origem_ref, ativo, atualizado_por, atualizado_em)
values
  -- ETHB (Encontro do Time Holding Brasil, produto 5951389) — ingressos e migrações de lote.
  ('v555h8xb', '5951389', 'Encontro do Time Holding Brasil', 'ETHB 2026 — ingresso', 'R101026783U', 'ingresso',
   'Descoberta no banco em 17/08/2026: 83 compras aprovadas, R$ 82.751,65, de 08/06 a 31/07. Nao veio na planilha. Falta o link de checkout e o valor de tabela.',
   'webhook', 'compras:83 aprovadas R$82751,65 08/06-31/07/2026', true, 'migration:0262', now()),
  ('gignq95i', '5951389', 'Encontro do Time Holding Brasil', 'ETHB 2026 — ingresso', 'R101026783U', 'ingresso',
   'Descoberta no banco em 17/08/2026: 31 compras aprovadas, R$ 61.907,08, de 10/06 a 01/07. Nao veio na planilha. Falta o link de checkout e o valor de tabela.',
   'webhook', 'compras:31 aprovadas R$61907,08 10/06-01/07/2026', true, 'migration:0262', now()),
  ('jnzjixvf', '5951389', 'Encontro do Time Holding Brasil', 'ETHB 2026 — ingresso', 'R101026783U', 'ingresso',
   'Descoberta no banco em 17/08/2026: 73 compras aprovadas, R$ 36.281,12, de 10/06 a 31/07. Nao veio na planilha. Falta o link de checkout e o valor de tabela.',
   'webhook', 'compras:73 aprovadas R$36281,12 10/06-31/07/2026', true, 'migration:0262', now()),
  ('iaw505e9', '5951389', 'Encontro do Time Holding Brasil', 'ETHB 2026 — ingresso', 'R101026783U', 'ingresso',
   'Descoberta no banco em 17/08/2026: 1 compra aprovada, R$ 1.997,02, em 26/06. Nao veio na planilha. Falta o link de checkout e o valor de tabela.',
   'webhook', 'compras:1 aprovada R$1997,02 26/06/2026', true, 'migration:0262', now()),
  -- 6xys4ypa e t8yzswu6 VIERAM na planilha, mas sem link, e estao em quarentena (0256). Entram no
  -- catalogo aqui pelo que o banco prova, para o dinheiro deles parar de ser invisivel — a
  -- quarentena continua valendo para o VALOR e o LINK, que so o Marcio pode confirmar.
  ('6xys4ypa', '5951389', 'Encontro do Time Holding Brasil', 'ETHB 2026 — Acesso Plateia Lote 2', 'R101026783U', 'ingresso',
   'Veio na planilha SEM link e esta em quarentena (0256) para valor/link. Cadastrada aqui pelo que o banco prova: 39 compras aprovadas, R$ 31.083,05, de 08/07 a 03/08.',
   'webhook', 'compras:39 aprovadas R$31083,05 08/07-03/08/2026; planilha em quarentena', true, 'migration:0262', now()),
  ('t8yzswu6', '5951389', 'Encontro do Time Holding Brasil', 'ETHB 2026 — Acesso VIP Lote 2', 'R101026783U', 'ingresso',
   'Veio na planilha SEM link e esta em quarentena (0256) para valor/link. Cadastrada aqui pelo que o banco prova: 28 compras aprovadas, R$ 41.916,04, de 03/07 a 03/08.',
   'webhook', 'compras:28 aprovadas R$41916,04 03/07-03/08/2026; planilha em quarentena', true, 'migration:0262', now()),
  -- Holding Total (1560865) e VIP - Holding Total (2414291) — outra esteira, entram so para o
  -- dinheiro deixar de ser desconhecido. papel NULO de proposito: nao foi medido o que cada uma e.
  ('3mcmh0eu', '1560865', 'Holding Total', 'Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 642 compras aprovadas, R$ 39.745,82, de 27/03 a 16/08 — a oferta mais vendida em volume de todo o sistema, e nao estava no catalogo.',
   'webhook', 'compras:642 aprovadas R$39745,82 27/03-16/08/2026', true, 'migration:0262', now()),
  ('3ibfkj0l', '1560865', 'Holding Total', 'Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 1 compra aprovada, R$ 4.997,00, em 31/07.',
   'webhook', 'compras:1 aprovada R$4997,00 31/07/2026', true, 'migration:0262', now()),
  ('4vn5e2td', '1560865', 'Holding Total', 'Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 33 compras aprovadas, R$ 2.625,03, de 13/03 a 15/04.',
   'webhook', 'compras:33 aprovadas R$2625,03 13/03-15/04/2026', true, 'migration:0262', now()),
  ('ipiazmgc', '1560865', 'Holding Total', 'Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 9 compras aprovadas, R$ 90,00, de 29/06 a 01/07.',
   'webhook', 'compras:9 aprovadas R$90,00 29/06-01/07/2026', true, 'migration:0262', now()),
  ('fuwxk6uw', '2414291', 'VIP - Holding Total', 'VIP - Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 1 compra aprovada, R$ 197,00, em 01/04.',
   'webhook', 'compras:1 aprovada R$197,00 01/04/2026', true, 'migration:0262', now()),
  ('hh95cubo', '2414291', 'VIP - Holding Total', 'VIP - Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 1 compra aprovada, R$ 148,00, em 13/03.',
   'webhook', 'compras:1 aprovada R$148,00 13/03/2026', true, 'migration:0262', now()),
  ('c5784eee', '2414291', 'VIP - Holding Total', 'VIP - Holding Total', null, null,
   'Descoberta no banco em 17/08/2026: 1 compra aprovada, R$ 94,00, em 14/03.',
   'webhook', 'compras:1 aprovada R$94,00 14/03/2026', true, 'migration:0262', now()),
  -- Clinica de Holding Familiar (5682989) e Holding Mais (6990981).
  ('ox5lfspp', '5682989', 'Clínica de Holding Familiar', 'Clínica de Holding Familiar', null, null,
   'Descoberta no banco em 17/08/2026: 1 compra aprovada, R$ 5.000,00, em 30/07.',
   'webhook', 'compras:1 aprovada R$5000,00 30/07/2026', true, 'migration:0262', now()),
  ('glgqcro3', '5682989', 'Clínica de Holding Familiar', 'Clínica de Holding Familiar', null, null,
   'Descoberta no banco em 17/08/2026: 2 compras aprovadas, R$ 1.993,86, em 08/06.',
   'webhook', 'compras:2 aprovadas R$1993,86 08/06/2026', true, 'migration:0262', now()),
  ('gyh8rztv', '6990981', 'Holding Mais', 'Holding Mais', null, null,
   'Descoberta no banco em 17/08/2026: 5 compras aprovadas de valor ZERO (R$ 0,00), de 09/06 a 24/06 — cortesia ou brinde. Conferir com o Marcio se e para continuar assim.',
   'webhook', 'compras:5 aprovadas R$0,00 09/06-24/06/2026', true, 'migration:0262', now())
on conflict (offer_code) do nothing;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA: depois desta migration, NENHUMA oferta com dinheiro aprovado pode estar fora do
-- catálogo. Se sobrar alguma, é oferta que nasceu entre o CONTAR ANTES e o apply — a migration
-- falha e a pessoa que aplicou vai ver qual é.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fora int;
  v_dinheiro numeric;
begin
  select count(*), coalesce(sum(x.soma), 0) into v_fora, v_dinheiro
    from (
      select c.oferta_codigo, sum(c.preco) soma
        from public.compras c
        left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
       where c.status in ('APPROVED','COMPLETE','COMPLETED')
         and c.oferta_codigo is not null
         and cat.offer_code is null
       group by 1
    ) x;

  if v_fora <> 0 then
    raise exception '0262: ainda existem % oferta(s) com dinheiro aprovado fora do catalogo (R$ %). Rodar a query do CONTAR ANTES e cadastrar as novas antes de aceitar.',
      v_fora, v_dinheiro;
  end if;

  raise notice '0262: nenhuma oferta com dinheiro aprovado esta fora do catalogo. Catalogo: % ofertas, % sem valor_tabela (lista de trabalho da tela {base}/ofertas).',
    (select count(*) from public.hm_product_catalog),
    (select count(*) from public.hm_product_catalog where valor_tabela is null);
end $$;

-- Volta:
--   delete from public.hm_product_catalog where origem_ref like 'compras:%' and atualizado_por = 'migration:0262';
-- Seguro: estas 16 linhas nascem nesta migration, nenhuma régua depende delas, e nenhuma view
-- financeira as lê (o catálogo é consultado por offer_code, e antes disso elas simplesmente não
-- eram encontradas).
