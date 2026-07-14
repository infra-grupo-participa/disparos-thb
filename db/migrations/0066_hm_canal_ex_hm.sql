-- =====================================================================
-- 0066_hm_canal_ex_hm
-- A oferta de 13/07 foi para Ex-HM — e o sistema carimbou "Venda direta".
--
-- No pitch de 13/07 às 20h, 39 pessoas pagaram o sinal de R$300 (a mesma porta
-- de entrada de sempre, z391kxd9). Como a oferta é a mesma de todos os eventos,
-- o canal vem da JANELA da edição (regra da 0052/0063) — e a janela de 13/07
-- não existia em fn_hm_janela_evento. Resultado: 38 cards nasceram "Venda
-- direta", que é o rótulo de quem NÃO veio de evento nenhum.
--
-- O público desta edição era Ex-HM (ex-alunos do Holding Masters). Detalhe que
-- vale registrar: nenhum dos 39 casou com public.thb_alunos na criação do card
-- (todos nasceram "Lead novo") — esse público é de antes da base existir. Se a
-- regra de quitação deles não for a de lead novo (nascer na T39), isso é uma
-- decisão futura; o canal não depende dela.
--
-- Janela decidida com o time: só o dia 13/07 (fechou às 00:00 de 14/07). Venda
-- de hoje em diante volta a ser "Venda direta". A janela vale pela data da
-- VENDA (não da aprovação — 0063): um boleto vendido em 13/07 e aprovado dias
-- depois ainda nasce com o canal da edição, porque o card dele é criado na aprovação.
--
-- Quem tem ingresso de HT ganha o canal pelo ingresso antes da janela (é o caso
-- do card com "HT26" da mesma noite) — essa precedência não muda aqui.
-- Idempotente.
-- =====================================================================

-- 1) A janela de 13/07 no derivador de canal ---------------------------------
create or replace function cs.fn_hm_janela_evento(p_venda_em timestamptz)
returns text
language sql
immutable
as $fn$
  select case
    when p_venda_em >= '2026-06-25 00:00:00-03' and p_venda_em < '2026-06-27 00:00:00-03' then 'Live Direto ao Ponto'
    when p_venda_em >= '2026-07-06 00:00:00-03' and p_venda_em < '2026-07-08 00:00:00-03' then 'HT ATM'
    when p_venda_em >= '2026-07-13 00:00:00-03' and p_venda_em < '2026-07-14 00:00:00-03' then 'Ex aluno Direto ao Ponto'
    else 'Venda direta'
  end;
$fn$;

-- 2) Recarimba quem a janela agora reconhece ---------------------------------
-- Troca a tag no card de quem tem sinal aprovado VENDIDO dentro da janela e
-- ficou como "Venda direta". Não mexe em atualizado_em: canal é derivação, não
-- edição — o "tempo na etapa" e o desempate do board não podem andar por isso.
update cs.contatos_hm ch
   set tags = array_replace(ch.tags, 'Venda direta', 'Ex aluno Direto ao Ponto')
 where 'Venda direta' = any(ch.tags)
   and exists (
     select 1
       from public.compras c
       join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      where c.comprador_id = ch.comprador_id
        and cat.categoria = 'sinal'
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
        and coalesce(c.data_compra, c.data_aprovacao) >= '2026-07-13 00:00:00-03'
        and coalesce(c.data_compra, c.data_aprovacao) <  '2026-07-14 00:00:00-03');
