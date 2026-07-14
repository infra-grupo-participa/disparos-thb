-- =====================================================================
-- 0087_pagamentos_so_grita_o_que_importa
--
-- A 0086 acusava R$ 240 mil "sem destino" — mas 191 daqueles pagamentos eram
-- ingressos do Encontro e 475 eram Holding Total: outro negócio, não buraco. E as
-- 22 "compras cheias sem destino" eram de turmas ANTERIORES à T39, que o gatilho
-- ignora de propósito (cutoff de 25/06).
--
-- Um painel que grita com tudo é um painel que ninguém olha — o mesmo erro do
-- alerta que subia 41 leads ao topo por terem pago o sinal de entrada. Depois deste
-- recorte sobram 6 pagamentos (R$ 18.261,18) que de fato precisam de uma pessoa.
--
-- Aditiva e idempotente. (Conteúdo aplicado no banco em 14/07/2026.)
-- =====================================================================

create or replace view cs.vw_pagamentos as
select
  c.id as compra_id, c.comprador_id, cp.nome, cp.email, cp.telefone,
  c.produto_nome, c.oferta_codigo,
  coalesce(cat.categoria, 'fora_do_catalogo') as categoria,
  cat.notes as oferta_descricao,
  c.preco as valor, c.metodo_pagamento, c.parcelas,
  coalesce(c.data_aprovacao, c.data_compra) as pago_em,
  c.hotmart_transaction as transacao,
  exists (select 1 from cs.contatos_hm ch
           where ch.comprador_id = cs.fn_hm_dono_do_pagamento(c.comprador_id)) as tem_card_hm,
  exists (select 1 from cs.hm_pagamentos p
           where p.transacao = c.hotmart_transaction) as no_razao_hm,
  exists (select 1 from public.thb_alunos a
           where a.comprador_id = c.comprador_id
              or lower(trim(a.email)) = lower(trim(cp.email))) as tem_aluno,
  case
    -- 1. Reconhecido: entrou no razão do HM.
    when exists (select 1 from cs.hm_pagamentos p where p.transacao = c.hotmart_transaction)
      then 'lancado_no_hm'
    -- 2. Não é Holding Masters: ingresso do Encontro, Holding Total, Clínica. Entra
    --    no caixa por outra porta e não tem nada que fazer no funil do HM.
    when c.produto_nome not ilike '%Holding Masters%'
      then 'outro_produto'
    -- 3. Renovação/reserva: deveria estender o acesso de um aluno...
    when coalesce(cat.categoria, '') in ('renovacao', 'reserva')
         and exists (select 1 from public.thb_alunos a
                      where a.comprador_id = c.comprador_id
                         or lower(trim(a.email)) = lower(trim(cp.email)))
      then 'renovacao_de_aluno'
    --    ...mas o aluno não existe. Pagou para renovar o que o sistema não conhece.
    when coalesce(cat.categoria, '') in ('renovacao', 'reserva')
      then 'renovacao_sem_aluno'
    -- 4. Compra do HM anterior à T39 (cutoff 25/06): turma antiga, fora deste funil.
    when coalesce(c.data_aprovacao, c.data_compra) < '2026-06-25 00:00:00+00'
      then 'turma_anterior'
    -- 5. Oferta de HM que ninguém cadastrou: o gatilho a ignora EM SILÊNCIO e o
    --    pagamento evapora. Foi o caso do Alexandre (m0qvagzx, R$ 8.782,21).
    when cat.categoria is null
      then 'oferta_desconhecida'
    -- 6. Categoria conhecida do HM, pós-cutoff, e ainda assim ninguém reivindicou.
    else 'sem_destino'
  end as destino
from public.compras c
join public.compradores cp on cp.id = c.comprador_id
left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
where c.status in ('APPROVED', 'COMPLETE', 'COMPLETED')
  and coalesce(c.preco, 0) > 0;

grant select on cs.vw_pagamentos to disparos_app;

-- Só o que precisa de uma pessoa. Se esta view volta vazia, nenhum real se perdeu.
create or replace view cs.vw_pagamentos_sem_destino as
select nome, email, telefone, produto_nome, oferta_codigo, oferta_descricao,
       categoria, destino, valor, pago_em, transacao, tem_aluno, tem_card_hm,
       (current_date - pago_em::date) as dias_parado
  from cs.vw_pagamentos
 where destino in ('renovacao_sem_aluno', 'oferta_desconhecida', 'sem_destino')
 order by pago_em desc;

grant select on cs.vw_pagamentos_sem_destino to disparos_app;
