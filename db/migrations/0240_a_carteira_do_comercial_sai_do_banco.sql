-- 0240_a_carteira_do_comercial_sai_do_banco.sql
-- A carteira de cada pessoa do comercial deixa de ser reconstruída à mão em cada
-- relatório e passa a SAIR do banco, com a origem da atribuição declarada em cada linha.
--
-- Pedido do João (16/08/2026): a Kelly precisou levar ao Marcio a lista de quem pagou o
-- sinal do HM, de quem era o card e quem pagou o restante. Montei a planilha por fora, no
-- SQL — e a medição achou dois furos que também afetam o dashboard de desempenho que já
-- está no ar (`/api/hm/atividade/desempenho`, que credita por `responsavel_comercial_id`):
--
--   1) O CAMPO NÃO É QUEM VENDEU. A 0161 (10/08) faz TODA venda nova de HM e AURUM nascer
--      com a Kelly como responsável, porque ela distribui; a 0212 copia isso para
--      `responsavel_comercial_id`. Medido: 32 cards com sinal têm o carimbo automático.
--   2) O DONO SOME NA ATIVAÇÃO. Quem pega o card depois do pagamento sobrescreve
--      `responsavel_id`; medido: 131 dos 264 cards do HM sem `responsavel_comercial_id`.
--
-- Somados, os dois vieses inflam a carteira da Kelly e apagam a da Jusy. Um painel de
-- desempenho lido cru dá o crédito à pessoa errada — e este é o painel que decide conversa
-- sobre gente. Ver [[Carteira do card se perde na ativação]] no disparos-brain.
--
-- ---------------------------------------------------------------------------
-- A ESCADA DE ATRIBUIÇÃO — e por que ela declara a própria origem
--
-- Cada card responde "de quem é" pelo primeiro degrau que ele alcança, e a view devolve
-- SEMPRE qual degrau foi usado (`carteira_origem`), para a tela poder mostrar o lastro em
-- vez de afirmar sozinha:
--
--   1 atribuicao   — a linha do tempo registra "Responsável atribuído/alterado" (a última vale)
--   2 nota         — ela escreveu nota no card, e só ela aparece
--   3 operacao     — ela operou pagamento/acesso (interação de sistema assinada), e só ela
--   4 etapa_venda  — ela moveu o card para reunião/pagamento/entrevista/liberação, e só ela
--   5 triagem      — a única marca dela é mover para "Aguardando Retorno"/"Contato Inicial"
--                    (é o gesto da distribuidora — NÃO prova venda)
--   6 campo        — nenhuma ação; só `responsavel_comercial_id`, e só quando o card NÃO
--                    tem o carimbo automático da 0161
--   7 sem_dono     — nada disso. Fica nominal, sem ser jogado em ninguém.
--
-- Os degraus 1–4 são o que sustenta relatório de carteira. Os degraus 5–7 saem marcados:
-- quem consome decide se conta, mas ninguém consome sem saber.
--
-- ---------------------------------------------------------------------------
-- QUAL PAGAMENTO É "O SINAL" — a regra vira dado, não fica no SQL de quem pergunta
--
-- `hm_product_catalog.categoria = 'sinal'` mistura três coisas (medido em 16/08): a entrada
-- do programa (R$ 300 `z391kxd9`, R$ 697 `rlgjsrul`), a taxa de inscrição do AURUM
-- (R$ 1.000 `qm4lu7py`) e ofertas de evento/downsell de R$ 2.000 e R$ 2.497 — esta última
-- com o próprio `notes` dizendo "NÃO é o programa R$15k". Contar "quem pagou o sinal" pela
-- categoria inflaria a lista em 47 pessoas e misturaria renovação com venda nova.
--
-- Por isso a coluna `entrada_do_programa`: a decisão de o que é entrada do programa é da
-- operação, não do rótulo da categoria. Oferta nova de entrada precisa ser marcada aqui.
--
-- Aditivo: uma coluna com default false e uma view. Não altera dado existente além da
-- marcação das duas ofertas, não toca card, não toca razão. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) A regra do sinal vira dado
alter table public.hm_product_catalog
  add column if not exists entrada_do_programa boolean not null default false;

comment on column public.hm_product_catalog.entrada_do_programa is
  '0240: esta oferta é a ENTRADA do programa de implementação (o "sinal"). categoria=''sinal'' nao serve para isso: ela junta entrada do HM, taxa do AURUM e oferta de evento/downsell. Marcar a mao quando nascer oferta nova de entrada.';

update public.hm_product_catalog
   set entrada_do_programa = true
 where offer_code in ('z391kxd9', 'rlgjsrul');

do $$
declare v_n int;
begin
  select count(*) into v_n from public.hm_product_catalog where entrada_do_programa;
  if v_n = 0 then
    raise exception '0240: nenhuma oferta marcada como entrada do programa — a view sairia vazia e o relatorio diria que ninguem pagou sinal.';
  end if;
  raise notice '0240: % oferta(s) marcada(s) como entrada do programa.', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 2) A carteira, gerada — UMA LINHA POR CARD
--
-- Uma linha por card (pessoa × produto, 0163), nunca por pessoa: quem tem card no HM e no
-- AURUM tem dinheiro separado, e juntar os dois é o bug que a 0196/0197 passou a caçar.
create or replace view cs.vw_hm_carteira as
with oferta_produto as (
  -- De qual board é cada oferta. `product_id` primeiro (fato da Hotmart), nome como reserva.
  select offer_code,
         case when product_id in ('5064314','3507214') then 'HM'
              when product_id = '3094405'              then 'AURUM'
              when product_name ilike 'aurum%'         then 'AURUM'
              when product_name ilike 'holding masters%' then 'HM'
         end as produto
    from public.hm_product_catalog
),
cards_por_pessoa as (
  select comprador_id, count(*) as n, max(produto) as produto_unico
    from cs.contatos_hm group by comprador_id
),
pagamento as (
  -- Todo lançamento do razão com o board resolvido. A ordem importa: catálogo → tabela de
  -- ofertas de saldo (as do HM que ainda não estão catalogadas) → o card único da pessoa.
  select p.*,
         coalesce(
           op.produto,
           case when exists (select 1 from cs.hm_ofertas_saldo s where s.codigo = p.oferta_codigo) then 'HM' end,
           case when cp.n = 1 then cp.produto_unico end
         ) as produto
    from cs.hm_pagamentos p
    left join oferta_produto op on op.offer_code = p.oferta_codigo
    left join cards_por_pessoa cp on cp.comprador_id = p.comprador_id
),
sinal as (
  select pg.comprador_id,
         sum(pg.valor)                                as valor,
         min(pg.pago_em)                              as pago_em,
         string_agg(distinct pg.oferta_codigo, ' ')   as ofertas
    from pagamento pg
    join public.hm_product_catalog c on c.offer_code = pg.oferta_codigo and c.entrada_do_programa
   where pg.categoria = 'sinal'
   group by pg.comprador_id
),
entrada_qualquer as (
  -- Toda entrada, inclusive AURUM e ofertas de evento — para a tela poder explicar quem
  -- pagou alguma entrada mas NÃO entra na lista do programa.
  select comprador_id, produto, sum(valor) as valor, min(pago_em) as pago_em,
         string_agg(distinct oferta_codigo, ' ') as ofertas
    from pagamento where categoria = 'sinal' group by comprador_id, produto
),
restante as (
  select comprador_id, produto, sum(valor) as valor, max(pago_em) as ultimo, count(*) as n
    from pagamento where categoria in ('saldo','compra_cheia') group by comprador_id, produto
),
parcelas as (
  select comprador_id, produto, sum(valor) as valor, max(pago_em) as ultimo, count(*) as n
    from pagamento where categoria = 'mensalidade' group by comprador_id, produto
),
entrada_estornada as (
  -- O razão guarda o lançamento; o estorno vive em public.compras. Sem isto, quem pediu
  -- reembolso continua contado como venda.
  select cr.comprador_id,
         string_agg(distinct cr.status::text, ',') as status,
         max(cr.data_compra)::date                 as em
    from public.compras cr
    join public.hm_product_catalog c on c.offer_code = cr.oferta_codigo and c.entrada_do_programa
   where cr.status in ('REFUNDED','PROTESTED','CHARGEBACK')
   group by cr.comprador_id
),
atribuicao as (
  -- Último "Responsável atribuído/alterado/removido" do card. O nome vem do texto porque é
  -- o que a timeline guarda; a coluna do card não preserva o histórico.
  select contato_hm_id, criado_em, autor,
         case when descricao ilike 'Respons%vel alterado de %' then substring(descricao from 'para "([^"]+)"')
              when descricao ilike 'Respons%vel atribu%'       then substring(descricao from 'atribu[íi]do: "([^"]+)"')
              else '(pool)'
         end as dono,
         row_number() over (partition by contato_hm_id order by criado_em desc) as rn
    from cs.interacoes
   where descricao ilike 'Respons%vel atribu%'
      or descricao ilike 'Respons%vel alterado de %'
      or descricao ilike 'Respons%vel removido%'
),
atuacao as (
  -- O que cada pessoa fez no card, separado por natureza. `sistema` com autor humano é ação
  -- de operação (registrou pagamento, criou aluno, enviou link) — não é evento automático:
  -- o robô assina 'sistema'/'hotmart'.
  select i.contato_hm_id, i.autor,
         count(*) filter (where i.tipo = 'nota')    as notas,
         count(*) filter (where i.tipo = 'sistema') as operacoes,
         count(*) filter (where i.tipo = 'mudanca_estagio' and (
                 i.descricao ilike '%Reuni%' or i.descricao ilike '%Pagamento Realizado%'
              or i.descricao ilike '%Apto para Ativa%' or i.descricao ilike '%Entrevista%'
              or i.descricao ilike '%Acesso Liberado%' or i.descricao ilike '%Pendente de Libera%')) as etapas_de_venda,
         count(*) as total
    from cs.interacoes i
   where i.autor is not null and i.autor not in ('sistema','hotmart')
   group by i.contato_hm_id, i.autor
),
atuacao_unica as (
  -- Só serve de lastro quando UMA pessoa do comercial aparece no card. Duas → 'ambas'.
  select a.contato_hm_id,
         count(*)                                          as quantos,
         min(a.autor)                                      as autor,
         max(a.notas)                                      as notas,
         max(a.operacoes)                                  as operacoes,
         max(a.etapas_de_venda)                            as etapas_de_venda,
         max(a.total)                                      as total
    from atuacao a
    join cs.usuarios u on lower(btrim(u.nome)) = lower(btrim(a.autor))
   where u.ativo
   group by a.contato_hm_id
),
carimbo_automatico as (
  select distinct contato_hm_id from cs.interacoes where descricao ilike 'Venda nova atribu%'
)
select
  ch.id                                          as contato_hm_id,
  ch.comprador_id,
  coalesce(ch.produto, 'HM')                     as produto,
  cp.nome, cp.email, cp.telefone, cp.documento,

  -- ---- carteira, pela escada ----
  case
    when ua.id       is not null then ua.nome                    -- 1 atribuição registrada
    when au.autor    is not null and au.quantos = 1 then au.autor -- 2..5 atuação exclusiva
    when uc.id       is not null and ca.contato_hm_id is null then uc.nome  -- 6 campo, sem carimbo
  end                                            as carteira_nome,
  case
    when ua.id       is not null then ua.id
    when au.autor    is not null and au.quantos = 1 then uau.id
    when uc.id       is not null and ca.contato_hm_id is null then uc.id
  end                                            as carteira_usuario_id,
  case
    when ua.id is not null                                   then 'atribuicao'
    when au.quantos > 1                                      then 'ambas'
    when au.notas           > 0                              then 'nota'
    when au.operacoes       > 0                              then 'operacao'
    when au.etapas_de_venda > 0                              then 'etapa_venda'
    when au.autor is not null                                then 'triagem'
    when uc.id is not null and ca.contato_hm_id is null      then 'campo'
    else 'sem_dono'
  end                                            as carteira_origem,
  case
    when ua.id is not null then 'Atribuição registrada no card em ' || to_char(atr.criado_em, 'DD/MM/YYYY') || ' por ' || atr.autor
    when au.quantos > 1 then 'Mais de uma pessoa do comercial atuou no card'
    when au.notas > 0 then au.autor || ' escreveu ' || au.notas || ' nota(s) no card'
    when au.operacoes > 0 then au.autor || ' operou pagamento/acesso ' || au.operacoes || 'x'
    when au.etapas_de_venda > 0 then au.autor || ' conduziu ' || au.etapas_de_venda || ' etapa(s) da negociação'
    when au.autor is not null then au.autor || ' apenas moveu o card na entrada (' || au.total || ' ação/ões)'
    when uc.id is not null and ca.contato_hm_id is null then 'Responsável comercial gravado no card'
    else 'Nenhuma ação do comercial registrada neste card'
  end                                            as carteira_lastro,
  (ca.contato_hm_id is not null)                 as carimbo_automatico,

  -- ---- entrada ----
  (si.comprador_id is not null)                  as pagou_entrada_do_programa,
  si.valor                                       as sinal_valor,
  si.pago_em                                     as sinal_pago_em,
  si.ofertas                                     as sinal_ofertas,
  eq.valor                                       as entrada_qualquer_valor,
  eq.ofertas                                     as entrada_qualquer_ofertas,
  es.status                                      as entrada_estorno_status,
  es.em                                          as entrada_estorno_em,

  -- ---- restante ----
  re.valor                                       as restante_valor,
  re.ultimo                                      as restante_pago_em,
  coalesce(re.n, 0)                              as restante_lancamentos,
  pa.valor                                       as parcelas_valor,
  pa.ultimo                                      as parcelas_ultima_em,
  coalesce(pa.n, 0)                              as parcelas_lancamentos,
  case when coalesce(re.n,0) > 0 then 'pagou'
       when coalesce(pa.n,0) > 0 then 'parcelando'
       else 'so_entrada' end                     as restante_situacao,

  -- ---- estado do card ----
  case
    when ch.cancelamento_efetivado_em is not null then 'cancelado'
    when es.comprador_id is not null              then 'entrada_estornada'
    when ch.quitado_em is not null                then 'quitado'
    when coalesce(re.n,0) > 0                     then 'pagou_restante'
    when coalesce(pa.n,0) > 0                     then 'parcelando'
    else 'so_entrada'
  end                                            as status,
  f.pago                                         as total_pago,
  f.pacote_cravado                               as pacote,
  f.saldo_a_perseguir                            as falta_pagar,
  f.situacao                                     as situacao_financeira,
  f.publico                                      as perfil,
  ch.quitado_em,
  ch.cancelamento_efetivado_em                   as cancelado_em,
  ch.turma, ch.turma_origem,
  e.nome                                         as etapa,
  e.aba                                          as esteira,
  ch.criado_em                                   as card_criado_em,
  ch.responsavel_comercial_id,
  ch.responsavel_id
from cs.contatos_hm ch
join public.compradores cp on cp.id = ch.comprador_id
left join cs.estagios e on e.id = ch.estagio_id
left join cs.vw_hm_financeiro f on f.contato_hm_id = ch.id
left join sinal si on si.comprador_id = ch.comprador_id
left join entrada_qualquer eq on eq.comprador_id = ch.comprador_id and eq.produto = coalesce(ch.produto,'HM')
left join restante re on re.comprador_id = ch.comprador_id and re.produto = coalesce(ch.produto,'HM')
left join parcelas pa on pa.comprador_id = ch.comprador_id and pa.produto = coalesce(ch.produto,'HM')
left join entrada_estornada es on es.comprador_id = ch.comprador_id
left join atribuicao atr on atr.contato_hm_id = ch.id and atr.rn = 1
left join cs.usuarios ua on lower(btrim(ua.nome)) = lower(btrim(atr.dono))
left join atuacao_unica au on au.contato_hm_id = ch.id
left join cs.usuarios uau on lower(btrim(uau.nome)) = lower(btrim(au.autor))
left join carimbo_automatico ca on ca.contato_hm_id = ch.id
left join cs.usuarios uc on uc.id = ch.responsavel_comercial_id;

comment on view cs.vw_hm_carteira is
  '0240: uma linha por card (pessoa x produto) com a carteira reconstruida pela linha do tempo e a ORIGEM da atribuicao declarada (carteira_origem: atribuicao > nota > operacao > etapa_venda > triagem > campo > sem_dono). Nao usar responsavel_comercial_id sozinho: a 0161 carimba toda venda nova na distribuidora e a ativacao sobrescreve o dono. Entrada do programa vem de hm_product_catalog.entrada_do_programa, nunca de categoria=''sinal''.';

-- ---------------------------------------------------------------------------
-- 3) Conferência — a view precisa bater com o que foi medido à mão em 16/08
do $$
declare
  v_entrada int;
  v_sem_dono int;
begin
  select count(*) into v_entrada
    from cs.vw_hm_carteira where pagou_entrada_do_programa and produto = 'HM';
  if v_entrada < 200 then
    raise exception '0240: a view devolveu % cards de HM com entrada do programa (esperado ~242). Algo na cadeia de ofertas mudou — conferir antes de seguir.', v_entrada;
  end if;

  select count(*) into v_sem_dono
    from cs.vw_hm_carteira where pagou_entrada_do_programa and produto = 'HM' and carteira_origem = 'sem_dono';

  raise notice '0240: % cards de HM com entrada do programa, % sem dono identificado.', v_entrada, v_sem_dono;
end $$;
