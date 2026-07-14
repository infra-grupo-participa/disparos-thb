-- =====================================================================
-- 0086_todo_pagamento_tem_destino
--
-- TODO PAGAMENTO É METRIFICADO — INCLUSIVE OS QUE O SISTEMA NÃO SABE TRATAR.
--
-- O funil do HM conhece três categorias: sinal, saldo e compra cheia. Uma compra de
-- `renovacao` ou `reserva` entra em public.compras pelo webhook e... nada. Não vira
-- card, não entra no razão, não renova acesso, não aparece em relatório algum. O
-- dinheiro cai na conta e desaparece do sistema.
--
-- Três pessoas pagaram Renovação 2026 e NÃO EXISTEM na base de alunos:
--   Luiz Roberto Meirelles Teixeira · R$ 3.996,99 · 14/07
--   Leticia Taborda                 · R$ 3.997,00 · 03/07  (11 dias parado)
--   Alexandre Brito Piedade         · R$ 3.997,05 · 25/06  (19 dias parado)
-- Elas pagaram para renovar um acesso que o sistema não sabe que existe. Ninguém
-- renovou nada, e ninguém foi avisado.
--
-- Esta view não conserta o caso deles — conserta a CEGUEIRA. Todo pagamento passa a
-- ter um destino declarado, e o que não tiver aparece como `sem_destino`. Um
-- pagamento sem destino é um pedido de ajuda: ou falta uma regra, ou falta uma
-- pessoa fazer algo.
--
-- Aditiva e idempotente.
-- =====================================================================

create or replace view cs.vw_pagamentos as
select
  c.id                                   as compra_id,
  c.comprador_id,
  cp.nome,
  cp.email,
  cp.telefone,
  c.produto_nome,
  c.oferta_codigo,
  coalesce(cat.categoria, 'fora_do_catalogo')          as categoria,
  cat.notes                              as oferta_descricao,
  c.preco                                as valor,
  c.metodo_pagamento,
  c.parcelas,
  coalesce(c.data_aprovacao, c.data_compra)            as pago_em,
  c.hotmart_transaction                  as transacao,
  -- Onde este dinheiro foi parar
  exists (select 1 from cs.contatos_hm ch
           where ch.comprador_id = cs.fn_hm_dono_do_pagamento(c.comprador_id))     as tem_card_hm,
  exists (select 1 from cs.hm_pagamentos p
           where p.transacao = c.hotmart_transaction)                              as no_razao_hm,
  exists (select 1 from public.thb_alunos a
           where a.comprador_id = c.comprador_id
              or lower(trim(a.email)) = lower(trim(cp.email)))                     as tem_aluno,
  case
    -- O parcelado da Hotmart reenvia um evento por parcela: da 2ª em diante a compra
    -- É reconhecida (entra no razão), mas não abre card nem aluno de novo.
    when exists (select 1 from cs.hm_pagamentos p where p.transacao = c.hotmart_transaction)
      then 'lancado_no_hm'
    when coalesce(cat.categoria, '') in ('renovacao', 'reserva')
         and exists (select 1 from public.thb_alunos a
                      where a.comprador_id = c.comprador_id
                         or lower(trim(a.email)) = lower(trim(cp.email)))
      then 'renovacao_de_aluno'
    when coalesce(cat.categoria, '') in ('renovacao', 'reserva')
      then 'renovacao_sem_aluno'          -- pagou para renovar o que não existe
    when cat.categoria is null
      then 'oferta_desconhecida'          -- não está no catálogo: o gatilho ignora em silêncio
    else 'sem_destino'                    -- categoria do HM, mas ninguém a reivindicou
  end as destino
from public.compras c
join public.compradores cp on cp.id = c.comprador_id
left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
where c.status in ('APPROVED', 'COMPLETE', 'COMPLETED')
  and coalesce(c.preco, 0) > 0;

grant select on cs.vw_pagamentos to disparos_app;

-- O painel: quanto entrou, por categoria, e quanto disso o sistema NÃO tratou.
-- `parado` é o número que interessa — é dinheiro recebido que não virou nada.
create or replace view cs.vw_pagamentos_painel as
select
  categoria,
  destino,
  count(*)                as pagamentos,
  round(sum(valor), 2)    as total,
  max(pago_em)            as ultimo,
  bool_or(destino in ('renovacao_sem_aluno', 'oferta_desconhecida', 'sem_destino')) as precisa_de_alguem
from cs.vw_pagamentos
group by categoria, destino
order by precisa_de_alguem desc, total desc;

grant select on cs.vw_pagamentos_painel to disparos_app;
