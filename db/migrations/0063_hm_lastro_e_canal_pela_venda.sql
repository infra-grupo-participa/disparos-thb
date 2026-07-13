-- =====================================================================
-- 0061_hm_lastro_e_canal_pela_venda
-- Dois bugs que a auditoria de dados revelou. Ambos vinham de usar a data errada.
--
-- BUG 1 — "quitou" sem recorte de tempo (cs.fn_hm_tem_lastro)
--   A função perguntava "existe compra cheia aprovada?" e respondia sim para a
--   matrícula ANTIGA do aluno. Resultado: Áurea (compra de março), Pedro Henrique
--   (abril) e Naiara apareciam como quem já quitou a T39 — quando na verdade estão
--   no funil justamente para migrar, e ainda devem o saldo.
--   A Naiara mostrou que nem um corte por data resolve: ela comprou o HM cheio em
--   15/06 e só em 07/07 pagou o sinal do Programa de Implementação. A compra de
--   junho é a matrícula dela; o saldo do programa (com crédito pró-rata) segue em
--   aberto. Regra correta: a quitação tem que vir DEPOIS do sinal que abriu o card.
--
-- BUG 2 — canal pela data de APROVAÇÃO (cs.fn_tag_hm_origem)
--   Quem comprou no HT ATM em 06/07 às 20h teve a compra aprovada às 03h de 08/07
--   (boleto e pix demoram). Como a janela do evento olhava a aprovação, essas
--   pessoas caíam FORA do próprio evento em que estavam — por seis minutos.
--   Veridiane, Emerson, Edson Ayres e Rodrigo Monteiro ficaram sem canal nenhum.
--   O evento é o momento da VENDA; a aprovação é detalhe do meio de pagamento.
--
-- E "Venda direta": lead novo que paga o sinal fora de qualquer evento (link
-- avulso, indicação). Antes ficava sem tag — invisível no filtro de canal. Ele
-- não veio de um evento, mas também não é um vazio.
-- Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_tem_lastro(p_comprador_id uuid)
returns boolean
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  with entrada as (   -- o sinal que abriu este card (R$300 ou R$2.000)
    select min(coalesce(c.data_compra, c.data_aprovacao)) as em
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria = 'sinal'
  )
  select exists (
    select 1
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      left join entrada e on true
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and (
         cat.categoria = 'diferenca'                    -- o saldo do sinal sempre quita
         or (cat.categoria = 'compra_cheia' and (
              (e.em is not null and coalesce(c.data_compra, c.data_aprovacao) > e.em)
              or (e.em is null and coalesce(c.data_compra, c.data_aprovacao) >= '2026-06-01')
            ))
       ));
$fn$;

grant execute on function cs.fn_hm_tem_lastro(uuid) to disparos_app;

create or replace function cs.fn_hm_canal_imersao(p_comprador_id uuid)
returns text
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select 'Imersão POA'
    from public.compras c
   where c.comprador_id = p_comprador_id
     and c.oferta_codigo = 'nz3ob9r2'
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(c.data_compra, c.data_aprovacao) >= '2026-06-01'
   limit 1;
$fn$;

grant execute on function cs.fn_hm_canal_imersao(uuid) to disparos_app;

-- cs.fn_tag_hm_origem (v7): janela pela data da VENDA + canal "Venda direta".
-- O corpo completo está aplicado no banco; as mudanças em relação à 0060 são:
--   • v_dt := min(coalesce(c.data_compra, c.data_aprovacao))  -- era data_aprovacao
--   • else v_canal := 'Venda direta'                          -- era null (sem tag)
-- (mantido aqui como nota; a função é recriada por inteiro na 0060 + este patch)
create or replace function cs.fn_hm_janela_evento(p_venda_em timestamptz)
returns text
language sql
immutable
as $fn$
  select case
    when p_venda_em >= '2026-06-25 00:00:00-03' and p_venda_em < '2026-06-27 00:00:00-03' then 'Live Direto ao Ponto'
    when p_venda_em >= '2026-07-06 00:00:00-03' and p_venda_em < '2026-07-08 00:00:00-03' then 'HT ATM'
    else 'Venda direta'
  end;
$fn$;
