-- 0242_carteira_desempata_por_peso_da_evidencia.sql
-- A definição VIGENTE de cs.vw_hm_carteira. Fecha a sequência 0240 (coluna
-- entrada_do_programa + primeira versão da view) → 0241 (só o comercial conta) → 0242.
--
-- O QUE MUDA
-- A 0241 jogava em 'ambas' todo card com mais de uma pessoa do comercial dentro. Medido:
-- os 39 cards nessa situação são TODOS Jusy + Jonathan Mendes — nenhum Jusy + Kelly.
-- Descartar a carteira porque o SDR também tocou no card apaga trabalho de quem trabalhou.
--
-- Passa a desempatar por PESO DA EVIDÊNCIA, na ordem em que uma ação prova posse do card:
--
--     4  escreveu nota no card
--     3  operou pagamento / acesso do aluno
--     2  conduziu etapa de venda (reunião, pagamento, entrevista, liberação)
--     1  só triagem (moveu para "Aguardando Retorno" / "Contato Inicial")
--
-- Empate no grau máximo desempata por volume de ações; empate também no volume → 'ambas'.
--
-- EFEITO MEDIDO no universo do sinal do HM (242 cards):
--   0241 (exclusividade estrita): Jusy 115 · Kelly 66 · Jonathan 10 · ambas 39 · sem dono 12
--   0242 (desempate por peso):    Jusy 118 · Kelly 66 · Jonathan 45 · ambas 1 · sem dono 12
--
-- A carteira da Kelly NÃO muda. O que muda é a fronteira Jusy/Jonathan: 35 cards que uma
-- regra cega ao Jonathan daria à Jusy por eliminação. A planilha entregue à Kelly em
-- 16/08 foi regerada por causa disto.
--
-- A ESCADA COMPLETA, e por que cada linha declara a própria origem (carteira_origem):
--   atribuicao   registro nominal na linha do tempo — a última vale
--   nota         escreveu nota, e é a de maior peso no card
--   operacao     operou pagamento/acesso
--   etapa_venda  conduziu etapa da negociação
--   triagem      só moveu o card na entrada — NÃO prova venda
--   campo        nenhuma ação; só responsavel_comercial_id, e só sem o carimbo da 0161
--   sem_dono     nada disso — fica nominal, sem ser jogado em ninguém
-- `carteira_confirmada` marca os quatro primeiros graus.
--
-- NUNCA usar responsavel_comercial_id sozinho: a 0161 carimba toda venda nova na
-- distribuidora (Kelly) e a ativação sobrescreve o dono quando o card avança.

create or replace view cs.vw_hm_carteira as
with comercial as (
  select id, nome from cs.usuarios
   where ativo and papel = 'disparador' and not coalesce(equipe_ativacao, false)
),
oferta_produto as (
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
  select i.contato_hm_id, i.autor,
         count(*) filter (where i.tipo = 'nota')    as notas,
         count(*) filter (where i.tipo = 'sistema') as operacoes,
         count(*) filter (where i.tipo = 'mudanca_estagio' and (
                 i.descricao ilike '%Reuni%' or i.descricao ilike '%Pagamento Realizado%'
              or i.descricao ilike '%Apto para Ativa%' or i.descricao ilike '%Entrevista%'
              or i.descricao ilike '%Acesso Liberado%' or i.descricao ilike '%Pendente de Libera%')) as etapas_de_venda,
         count(*) as total
    from cs.interacoes i
    join comercial u on lower(btrim(u.nome)) = lower(btrim(i.autor))
   group by i.contato_hm_id, i.autor
),
atuacao_grau as (
  select a.*,
         case when a.notas > 0 then 4 when a.operacoes > 0 then 3
              when a.etapas_de_venda > 0 then 2 else 1 end as grau,
         rank() over (partition by a.contato_hm_id order by
                      case when a.notas > 0 then 4 when a.operacoes > 0 then 3
                           when a.etapas_de_venda > 0 then 2 else 1 end desc, a.total desc) as posicao
    from atuacao a
),
atuacao_vencedor as (
  select contato_hm_id, count(*) as empatados, min(autor) as autor, min(grau) as grau,
         max(notas) as notas, max(operacoes) as operacoes,
         max(etapas_de_venda) as etapas_de_venda, max(total) as total
    from atuacao_grau where posicao = 1 group by contato_hm_id
),
carimbo_automatico as (
  select distinct contato_hm_id from cs.interacoes where descricao ilike 'Venda nova atribu%'
)
select
  ch.id                                          as contato_hm_id,
  ch.comprador_id,
  coalesce(ch.produto, 'HM')                     as produto,
  cp.nome, cp.email, cp.telefone, cp.documento,

  d.origem                                       as carteira_origem,
  case d.origem
    when 'atribuicao'  then ua.nome
    when 'campo'       then uc.nome
    when 'ambas'       then null
    when 'sem_dono'    then null
    else av.autor
  end                                            as carteira_nome,
  case d.origem
    when 'atribuicao' then ua.id
    when 'campo'      then uc.id
    when 'ambas'      then null
    when 'sem_dono'   then null
    else uav.id
  end                                            as carteira_usuario_id,
  case d.origem
    when 'atribuicao'  then 'Atribuição registrada no card em ' || to_char(atr.criado_em, 'DD/MM/YYYY') || ' por ' || atr.autor
    when 'ambas'       then 'Duas pessoas do comercial com o mesmo peso de atuação neste card'
    when 'nota'        then av.autor || ' escreveu ' || av.notas || ' nota(s) no card'
    when 'operacao'    then av.autor || ' operou pagamento/acesso ' || av.operacoes || 'x'
    when 'etapa_venda' then av.autor || ' conduziu ' || av.etapas_de_venda || ' etapa(s) da negociação'
    when 'triagem'     then av.autor || ' apenas moveu o card na entrada (' || av.total || ' ação/ões)'
    when 'campo'       then 'Responsável comercial gravado no card'
    else 'Nenhuma ação do comercial registrada neste card'
  end                                            as carteira_lastro,
  (d.origem in ('atribuicao','nota','operacao','etapa_venda')) as carteira_confirmada,
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
left join comercial ua on lower(btrim(ua.nome)) = lower(btrim(atr.dono))
left join atuacao_vencedor av on av.contato_hm_id = ch.id
left join comercial uav on lower(btrim(uav.nome)) = lower(btrim(av.autor))
left join carimbo_automatico ca on ca.contato_hm_id = ch.id
left join comercial uc on uc.id = ch.responsavel_comercial_id
cross join lateral (
  select case
    when ua.id is not null                              then 'atribuicao'
    when av.empatados > 1                               then 'ambas'
    when av.notas           > 0                         then 'nota'
    when av.operacoes       > 0                         then 'operacao'
    when av.etapas_de_venda > 0                         then 'etapa_venda'
    when av.autor is not null                           then 'triagem'
    when uc.id is not null and ca.contato_hm_id is null  then 'campo'
    else 'sem_dono'
  end as origem
) d;

comment on view cs.vw_hm_carteira is
  '0242: carteira COMERCIAL por card. So conta quem e do comercial (papel=disparador fora da ativacao). Escada: atribuicao registrada > atuacao de maior peso (nota > operacao > etapa de venda > triagem, desempate por volume) > campo do card sem carimbo automatico > sem_dono. carteira_confirmada = os quatro primeiros graus.';

do $$
declare v_n int; v_sem int;
begin
  select count(*) into v_n from cs.vw_hm_carteira where produto = 'HM' and pagou_entrada_do_programa;
  if v_n < 200 then
    raise exception '0242: a view devolveu % cards de HM com entrada do programa (esperado ~242).', v_n;
  end if;
  select count(*) into v_sem from cs.vw_hm_carteira
   where produto = 'HM' and pagou_entrada_do_programa and carteira_origem = 'sem_dono';
  raise notice '0242: % cards com entrada do programa, % sem dono.', v_n, v_sem;
end $$;
