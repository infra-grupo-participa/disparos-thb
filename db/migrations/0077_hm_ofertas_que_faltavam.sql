-- =====================================================================
-- 0077_hm_ofertas_que_faltavam
--
-- OFERTA FORA DO CATÁLOGO É PAGAMENTO QUE EVAPORA.
--
-- O gatilho de venda (cs.fn_seed_contato_hm) busca a categoria da compra em
-- public.hm_product_catalog e, se não acha, `return new` — sai de fininho. O
-- mesmo vale para o razão (0075). Ou seja: uma oferta não cadastrada faz o
-- pagamento entrar em `public.compras` e NÃO virar nada — nem lançamento, nem
-- quitação, nem aluno. O dinheiro entra na conta e o sistema segue cobrando.
--
-- A planilha de links tem 43 ofertas de saldo. O banco conhecia 16. As outras 30
-- estavam vivas na Hotmart e mortas aqui — e uma delas JÁ TINHA VENDA:
--
--   Alexandre Barros Duarte · m0qvagzx · R$ 8.782,21 · cartão 12x · 14/07/2026
--   → o card dele mostra R$ 299,99 pagos. Ele quitou e o sistema não viu.
--
-- Cada oferta de saldo tem par à-vista/recorrente e já traz o pró-rata embutido
-- no valor (ver 0049) — por isso o valor da oferta É o saldo, não uma parcela.
--
-- Aditiva e idempotente.
-- =====================================================================

-- 1) As 30 ofertas que faltavam --------------------------------------------
insert into cs.hm_ofertas_saldo (codigo, valor, recorrente, link, ativo)
select v.codigo, v.valor, v.recorrente,
       'https://pay.hotmart.com/L97981750T?off=' || v.codigo, true
  from (values
    ('yuzm73ri',   645.21, false), ('71dywe6l',   645.21, true),
    ('ym44m2ea',  4968.49, false), ('faw8996d',  4968.49, true),
    ('cck38o0v',  6891.78, false), ('c81z7l0e',  6891.78, true),
    ('yqipi87j',  6932.88, false), ('hqe8z7r8',  6932.88, true),
    ('izxq8lmo',  7235.26, false), ('gtm8frjx',  7235.26, true),
    ('m0qvagzx',  8782.19, false), ('cudmp0uw',  8782.19, true),
    ('tomp81oq',  8823.29, false), ('sk9crwi3',  8823.29, true),
    ('7sjhxiz8',  9358.60, false), ('hzvq3ejv',  9358.60, true),
    ('sxjnedi5',  9440.78, false), ('pfp5ulqr',  9440.78, true),
    ('9rf41pie', 11806.85, false), ('mo0tcg47', 11806.85, true),
    ('j7lx2qdp', 11964.38, false), ('ig30cmda', 11964.38, true),
    ('8a7xapie', 12512.02, false), ('zped30fg', 12512.02, true),
    ('z244ubp2', 12501.93, false), ('cfc4g5qq', 12501.93, true),
    ('bgr5c91b', 12802.58, false), ('cqvhyjh7', 12802.58, true),
    ('du5wsb5t', 12990.41, false), ('p59n0ket', 12990.41, true)
  ) as v(codigo, valor, recorrente)
on conflict (codigo) do nothing;

-- 2) O catálogo é quem o gatilho consulta — sem isto, nada acontece ----------
insert into public.hm_product_catalog (offer_code, categoria, product_name, notes)
select os.codigo, 'diferenca', 'Holding Masters',
       'Saldo HM R$ ' || trim(to_char(os.valor, '999G999D99'))
         || case when os.recorrente then ' (recorrente)' else '' end
  from cs.hm_ofertas_saldo os
 where not exists (
   select 1 from public.hm_product_catalog pc where pc.offer_code = os.codigo
 );

-- 3) Reprocessa o que já tinha sido pago e o sistema ignorou -----------------
-- Estas compras nunca passaram pelo gatilho de venda (a oferta não existia).
-- Aqui elas fazem o percurso que teriam feito: viram lançamento no razão, o saldo
-- se recalcula e, se quitaram, o aluno nasce na base e o card sai da fila do
-- comercial — exatamente o que a 0050 faz para a categoria 'diferenca'.
do $reprocessa$
declare
  r       record;
  v_val   record;
  v_aluno uuid;
  v_etapa smallint;
begin
  for r in
    select c.id as compra_id, c.comprador_id, ch.id as card_id, ch.estagio_id,
           coalesce(c.data_aprovacao, c.data_compra) as pago_em, c.oferta_codigo
      from public.compras c
      join cs.contatos_hm ch on ch.comprador_id = c.comprador_id
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria = 'diferenca'
       and not exists (
         select 1 from cs.hm_pagamentos p where p.transacao = c.hotmart_transaction
       )
  loop
    perform cs.fn_hm_lancar_compra(r.compra_id);   -- o gatilho do razão recalcula o saldo

    select id into v_etapa from cs.estagios
     where evento = 'HM' and chave = cs.fn_hm_etapa_pos_pagamento(r.comprador_id) limit 1;

    update cs.contatos_hm
       set pagamento_em  = coalesce(pagamento_em, r.pago_em),
           apto_ativacao = true,
           estagio_id    = coalesce(v_etapa, estagio_id),
           atualizado_em = now()
     where id = r.card_id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (r.card_id, 'sistema',
            'Pagamento do saldo reconhecido no reprocessamento (oferta ' || r.oferta_codigo
            || ' não estava cadastrada — migration 0077)', 'sistema');

    begin
      select * into v_val from cs.fn_hm_valores_derivados(r.comprador_id);
      v_aluno := cs.fn_hm_provisionar_aluno(r.comprador_id, v_val.valor_total, v_val.valor_pago);
      if v_aluno is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (r.card_id, 'sistema', 'Aluno criado/atualizado na base THB (saldo quitado — 0077)', 'sistema');
      end if;
    exception when others then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (r.card_id, 'sistema', 'Falha ao criar o aluno na base THB no reprocessamento (' || sqlerrm || ')', 'sistema');
    end;

    -- fn_hm_provisionar_aluno reescreve valor_pago com a soma crua de compras.preco;
    -- a razão é a fonte da verdade, então ela dá a última palavra.
    perform cs.fn_hm_recalcular_financeiro(r.comprador_id);
  end loop;
end$reprocessa$;
