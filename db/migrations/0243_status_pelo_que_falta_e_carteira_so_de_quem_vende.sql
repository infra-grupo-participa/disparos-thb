-- 0243_status_pelo_que_falta_e_carteira_so_de_quem_vende.sql
-- Duas correções pedidas pelo João em 16/08/2026 — as duas da mesma natureza: a regra
-- estava INFERINDO o que precisa ser DECLARADO.
--
-- (a) O STATUS OLHAVA A EXISTÊNCIA DO LANÇAMENTO, NÃO O QUE FALTA
-- "Vi o caso do Mário Sérgio que você considerou como se tivesse pago tudo, sendo que ele
-- ainda está pagando." Ele pagou R$ 300 de entrada + R$ 1.556,34 de saldo num pacote de
-- R$ 15.000: devia R$ 13.143,66 e a carteira dizia "pagou tudo". Um lançamento de saldo
-- bastava para o card virar 'pagou_restante'.
--
-- Medido no universo do sinal do HM (242 cards) antes da correção:
--   140  só a entrada, nada depois                          R$ 1.974.013,67 em aberto
--    44  quitado_em com falta zerada                        (correto)
--    33  pagando em mensalidades                            R$ 385.574,70 em aberto
--    10  quitado_em com resíduo de centavos (0,01 a 0,32)   (é quitado)
--     9  cancelados
--     5  PAGOU PARTE DO SALDO E AINDA DEVE                  R$ 46.165,76  ← o caso relatado
--     1  quitado com saldo + mensalidade                    (correto)
--
-- Em carteira, esse é o pior erro possível: some com a cobrança de quem deve. Agora
-- `quitado` = falta <= R$ 1 (a tolerância existe porque o pró-rata deixa centavos), e quem
-- pagou parte do saldo e ainda deve vira `pagando_parcial`.
--
-- (b) CARTEIRA NÃO É PAPEL DE ACESSO, É FUNÇÃO DECLARADA
-- A 0241 assumiu que "comercial do HM" = papel 'disparador' fora da ativação. Isso pegou o
-- Jonathan Mendes, que apoia a esteira mas NÃO faz o comercial do HM — e 45 cards foram
-- creditados a ele. "Quem faz é a Jusy e a Kelly só" (João). Vira coluna:
-- `cs.usuarios.carteira_comercial`. Alguém novo no comercial entra marcando ali; ninguém
-- mais aparece por acidente de papel.
--
-- Efeito: os 45 cards do Jonathan voltam para quem tem o lastro seguinte na escada —
-- Jusy 118 → 162, Kelly 66 (inalterada), sem dono 12 → 14.

alter table cs.usuarios
  add column if not exists carteira_comercial boolean not null default false;

comment on column cs.usuarios.carteira_comercial is
  '0243: esta pessoa tem CARTEIRA propria no comercial do HM. Quem so apoia a esteira -- SDR, ativacao, admin -- fica fora, mesmo com papel de disparador. Marcar a mao quando alguem novo assumir carteira.';

update cs.usuarios set carteira_comercial = true
 where lower(btrim(email)) in ('jusy@advmais.com', 'kelly@advmais.com');

do $$
declare v_n int;
begin
  select count(*) into v_n from cs.usuarios where carteira_comercial and ativo;
  if v_n = 0 then
    raise exception '0243: ninguem marcado com carteira_comercial -- a carteira sairia inteira sem dono.';
  end if;
  raise notice '0243: % pessoa(s) com carteira no comercial do HM.', v_n;
end $$;

create or replace view cs.vw_hm_carteira as
with comercial as (
  -- Quem TEM carteira, declarado. Nao se deduz de papel de acesso (0243).
  select id, nome from cs.usuarios where ativo and carteira_comercial
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
    when coalesce(f.saldo_a_perseguir, case when ch.quitado_em is not null then 0 else null end) <= 1
                                                  then 'quitado'
    when coalesce(pa.n,0) > 0                     then 'parcelando'
    when coalesce(re.n,0) > 0                     then 'pagando_parcial'
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
  '0243: carteira COMERCIAL do HM por card. Dono sai da escada: atribuicao registrada > atuacao de maior peso (nota > operacao > etapa de venda > triagem) > campo do card sem carimbo automatico > sem_dono -- considerando SO quem tem cs.usuarios.carteira_comercial. Status pelo que FALTA (quitado = falta <= R$1; pagando_parcial = pagou parte do saldo e ainda deve).';

do $$
declare v_pp int; v_q int; v_sem int;
begin
  select count(*) filter (where status = 'pagando_parcial'),
         count(*) filter (where status = 'quitado'),
         count(*) filter (where carteira_origem = 'sem_dono')
    into v_pp, v_q, v_sem
    from cs.vw_hm_carteira where produto = 'HM' and pagou_entrada_do_programa;
  raise notice '0243: % pagando parcial (eram dados como pagos), % quitados, % sem dono.', v_pp, v_q, v_sem;
end $$;
