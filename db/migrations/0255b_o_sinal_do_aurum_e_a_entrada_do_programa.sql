-- 0255b_o_sinal_do_aurum_e_a_entrada_do_programa.sql
-- O sinal do AURUM (`qm4lu7py`, R$1.000) É a entrada do programa AURUM — e o
-- catálogo diz que não é. Achado do orquestrador em produção, 16/08/2026,
-- medindo `cs.vw_hm_carteira` por produto × `pagou_entrada_do_programa`:
--
--   AURUM  false  25 pessoas  falta 1.185.252,11  pago 191.747,87
--   AURUM  true   15 pessoas  falta   767.807,99  pago  15.300,03
--   HM     false  22 pessoas  falta   133.260,34  pago  93.216,50
--   HM     true  242 pessoas  falta 2.531.471,33  pago 893.585,81
--
-- Causa isolada em `public.hm_product_catalog`:
--   qm4lu7py (Sinal AURUM R$1.000)  categoria='sinal'  entrada_do_programa=FALSE  product_id=NULL
--   z391kxd9 (Sinal HM R$300, comparável) categoria='sinal'  entrada_do_programa=TRUE  product_id=5064314
--
-- `entrada_do_programa` (0240) é exatamente a coluna que resolve isso — foi
-- feita para não depender de `categoria`, que mistura eixos. `qm4lu7py` nasceu
-- ANTES da 0240 e nunca foi migrado para a régua nova: ficou com o default
-- `false`, silenciosamente. Mesmo defeito já registrado no vault
-- ("A Central escondia quem pagou o AURUM"), agora com a causa isolada nesta
-- linha.
--
-- Reconciliação medida pelo orquestrador, 16/08 (segunda rodada):
--   qm4lu7py (sinal AURUM)  35 compras · 35 pessoas · R$35.000,00 · 05-07/08 · status: APPROVED, COMPLETED, REFUNDED
--   nz3ob9r2                11 compras · 11 pessoas · R$22.000,02 · 18/04-17/06 · status: APPROVED, COMPLETE
--   6qxsk9kq                 5 compras ·  5 pessoas · R$12.484,97 · 23/06-12/08 · status: APPROVED
-- FIRE (frw73xd5, b6feodjs) e TRANSMISSÃO (ljiov5j3): ZERO compras em
-- public.compras. `cs.hotmart_eventos` também não serve de segunda fonte para
-- estas duas — só tem 152 linhas, todas de 15-17/07/2026, e só de HM (119),
-- Holding Total (23) e ETHB (10): não é um contador contínuo, é uma amostra de
-- 3 dias sem FIRE/Transmissão dentro dela. Por isso `cs.hm_produto_checkout_de_para`
-- (0255) fica com `product_id null` e `provado=false` para as duas: NÃO é
-- omissão, é ausência de evidência — não há, hoje, nenhuma fonte no banco que
-- prove o par produto_checkout↔product_id destas duas.
--
-- ---------------------------------------------------------------------------
-- O ESTORNO DO qm4lu7py — CONFIRMADO ANTES DE MEXER NA RÉGUA
--
-- Entre as 35 compras de qm4lu7py há pelo menos 1 REFUNDED. Pergunta: virar
-- `entrada_do_programa=true` faz o estornado contar como "entrada paga"?
--
-- SIM, sem o bloco abaixo — CONFIRMADO lendo a definição da view (0244,
-- `create or replace view cs.vw_hm_carteira`, CTE `sinal`/`si` e
-- `entrada_estornada`/`es`):
--   · `pagou_entrada_do_programa` = `(si.comprador_id is not null)` — SÓ
--     checa se existe lançamento no RAZÃO (`cs.hm_pagamentos`) casado com uma
--     oferta `entrada_do_programa=true`. Não olha estorno.
--   · `es` (entrada_estornada) é uma CTE SEPARADA, lida direto de
--     `public.compras` (status REFUNDED/PROTESTED/CHARGEBACK) — hoje ela só
--     alimenta a coluna `status` ('entrada_estornada'), NUNCA o boolean
--     `pagou_entrada_do_programa`.
--   · Busca em TODAS as migrations que tratam REFUNDED/CHARGEBACK/PROTESTED
--     (0071, 0091, 0094, 0101, 0115, 0131, 0139, 0181, 0183, 0193, 0208, 0218,
--     0240-0244): NENHUMA delas apaga ou reverte a linha em
--     `cs.hm_pagamentos` — o razão é histórico permanente, o estorno é um
--     OVERLAY. Ou seja, o lançamento do estornado de `qm4lu7py` já existe no
--     razão e passa a casar com `sinal` assim que `entrada_do_programa`
--     virar `true` — SEM o bloco abaixo, o estornado contaria como entrada
--     paga. É exatamente o "um real errado" que o João não admite.
--
-- CORREÇÃO: `pagou_entrada_do_programa` passa a exigir TAMBÉM que não haja
-- estorno (`es.comprador_id is null`). É correção GERAL da view — vale para
-- QUALQUER oferta com `entrada_do_programa=true`, não só para o AURUM; hoje
-- ela só não aparecia porque nenhuma entrada estornada tinha lançamento
-- casado (o HM já filtra estorno por outros caminhos na prática, mas o
-- boolean em si sempre teve este buraco). Patch cirúrgico (padrão 0247):
-- captura `pg_get_viewdef`, confere EXATAMENTE 1 ocorrência do padrão, e
-- FALHA (não aplica nada) se a view não estiver como esperado — não há
-- chute contra produção.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION MUDA NA RÉGUA (e só isto — nada de `papel`/vitrine é
-- confundido com régua aqui; as duas coisas estão em blocos separados)
--
-- 1) `pagou_entrada_do_programa` na view passa a excluir estorno (acima).
-- 2) `entrada_do_programa: false -> true` em UM offer_code: `qm4lu7py`.
-- Efeito: as pessoas do AURUM que pagaram o sinal E NÃO tiveram estorno
-- entram no recorte "entrada paga" que a carteira (0240) e o painel (B2)
-- usam. Quem teve estorno continua fora — corretamente, com o motivo visível
-- em `entrada_estorno_status`.
--
-- ---------------------------------------------------------------------------
-- CONTAR ANTES — medido pelo orquestrador em produção, 16/08/2026. RODAR DE
-- NOVO IMEDIATAMENTE ANTES DE APLICAR (o número muda com venda nova) e
-- conferir que segue batendo com o que o `do $$` abaixo vai comparar:
--
--   select produto, pagou_entrada_do_programa, count(*) pessoas,
--          sum(falta_pagar) falta, sum(total_pago) pago
--     from cs.vw_hm_carteira
--    where produto = 'AURUM'
--    group by produto, pagou_entrada_do_programa
--    order by pagou_entrada_do_programa;
--
-- Esperado ANTES: false=25 pessoas/1.185.252,11/191.747,87 · true=15/767.807,99/15.300,03.
-- Esperado DEPOIS: os 15 que já eram `true` NÃO se movem. Dos 25 que eram
-- `false`, quem tem `qm4lu7py` no razão E NÃO tem estorno vira `true`; quem
-- TEM estorno (>= 1 pessoa, pelas 35 compras de qm4lu7py com pelo menos 1
-- REFUNDED) continua `false` — o `do $$` final não exige mais "0 em false",
-- exige "todo mundo que ficou em false tem `entrada_estorno_status`
-- preenchido explicando por quê".
-- ---------------------------------------------------------------------------

do $$
declare
  v_antes_false_pessoas int;
  v_antes_false_falta   numeric;
  v_antes_false_pago    numeric;
begin
  select count(*), sum(falta_pagar), sum(total_pago)
    into v_antes_false_pessoas, v_antes_false_falta, v_antes_false_pago
    from cs.vw_hm_carteira
   where produto = 'AURUM' and not pagou_entrada_do_programa;

  raise notice '0255b: ANTES — AURUM sem entrada paga: % pessoas, falta %, pago % (esperado ~25 / ~1.185.252,11 / ~191.747,87 — pode ter mudado com venda nova).',
    v_antes_false_pessoas, v_antes_false_falta, v_antes_false_pago;
end $$;

-- ---------------------------------------------------------------------------
-- PATCH 1 — pagou_entrada_do_programa passa a excluir estorno.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def    text;
  -- 16/08, aplicando em produção: o padrão com parênteses não existia
  -- (`pg_get_viewdef` devolve `si.comprador_id IS NOT NULL AS ...`, sem
  -- parênteses). A trava fez o trabalho dela — falhou alto e não trocou nada.
  -- Padrão corrigido contra a definição real da view:
  v_padrao text := 'si\.comprador_id IS NOT NULL AS pagou_entrada_do_programa';
  v_novo   text := '(si.comprador_id IS NOT NULL AND es.comprador_id IS NULL) AS pagou_entrada_do_programa';
  v_qtd    int;
begin
  select pg_get_viewdef('cs.vw_hm_carteira'::regclass, true) into v_def;
  select count(*) into v_qtd from regexp_matches(v_def, v_padrao);

  if v_qtd <> 1 then
    raise exception '0255b: esperava 1 ocorrencia do padrao de pagou_entrada_do_programa em cs.vw_hm_carteira (pg_get_viewdef), achei %. NAO troquei nada — rodar "select pg_get_viewdef(''cs.vw_hm_carteira''::regclass, true)" e devolver ao backend para ajustar o padrao antes de reaplicar. O restante desta migration (entrada_do_programa de qm4lu7py, de-para, papel) NAO depende deste bloco e pode seguir mesmo se este falhar — mas ENTAO o estornado ficaria contando errado ate o patch entrar.', v_qtd;
  end if;

  execute 'create or replace view cs.vw_hm_carteira as ' || regexp_replace(v_def, v_padrao, v_novo);
  raise notice '0255b: pagou_entrada_do_programa agora exige es.comprador_id IS NULL — estorno para de contar como entrada paga, em qualquer oferta com entrada_do_programa=true (nao so AURUM).';
end $$;

-- ---------------------------------------------------------------------------
-- PATCH 2 — a régua do qm4lu7py, uma linha, um offer_code.
-- ---------------------------------------------------------------------------
update public.hm_product_catalog
   set entrada_do_programa = true
 where offer_code = 'qm4lu7py'
   and entrada_do_programa is distinct from true;

do $$
declare
  v_false_sem_estorno int;
  v_false_com_estorno int;
begin
  -- A invariante correta NÃO é "zero em false" (isso ignoraria o estornado
  -- de proposito) — é "quem ficou em false tem motivo explicito registrado".
  -- 16/08, medido ao aplicar: a invariante original ("0 em false sem estorno")
  -- falhou com 5 pessoas — e estava certa em falhar. As 5 pagaram o AURUM
  -- DIRETO no valor cheio/saldo (43.000,02 x2 · 21.500 · 3.871,50 · 1.376,35),
  -- sem passar pelo sinal de R$ 1.000, então nenhuma oferta de ENTRADA aparece
  -- no razão delas. Isso é decisão de produto do Marcio, não de migration:
  -- quem paga o saldo direto entrou no programa? Enquanto ele não responde,
  -- elas ficam fora do recorte, visíveis e nomeadas.
  -- A invariante passa a ser: quem fica em false tem motivo explícito —
  -- estorno, OU não ter pago nenhuma oferta de entrada.
  select count(*) into v_false_sem_estorno
    from cs.vw_hm_carteira
   where produto = 'AURUM' and not pagou_entrada_do_programa
     and entrada_estorno_status is null
     and entrada_qualquer_ofertas is not null;

  select count(*) into v_false_com_estorno
    from cs.vw_hm_carteira
   where produto = 'AURUM' and not pagou_entrada_do_programa and entrada_estorno_status is not null;

  if v_false_sem_estorno <> 0 then
    raise exception '0255b: esperava 0 pessoas do AURUM sem entrada paga E SEM estorno explicado, achei % — investigar antes de aceitar (pode ser outra oferta de sinal do AURUM fora de qm4lu7py, ou um caso novo).', v_false_sem_estorno;
  end if;

  raise notice '0255b: DEPOIS — 0 pessoas do AURUM em false sem motivo. % pessoa(s) em false COM entrada_estorno_status preenchido (esperado: quem teve qm4lu7py estornada) — correto, não contam como entrada paga.',
    v_false_com_estorno;
end $$;

-- ---------------------------------------------------------------------------
-- DE-PARA E VITRINE (0255) — descritivo, não é régua. Preenche SÓ o que está
-- nulo hoje (as 5 ofertas do AURUM estão com product_id/produto_checkout
-- nulos — é por isso que o de-para do webhook não as alcança) e classifica
-- `papel` (o eixo novo, separado de `categoria`, que segue legado e
-- intocada). `entrada` para o sinal (agora réguado acima); `saldo` para os
-- 4 saldos do AURUM.
-- ---------------------------------------------------------------------------
update public.hm_product_catalog
   set product_id       = coalesce(product_id, '3094405'),
       produto_checkout = coalesce(produto_checkout, 'P84471811S'),
       papel             = coalesce(papel, 'entrada')
 where offer_code = 'qm4lu7py';

update public.hm_product_catalog
   set product_id       = coalesce(product_id, '3094405'),
       produto_checkout = coalesce(produto_checkout, 'P84471811S'),
       papel             = coalesce(papel, 'saldo')
 where offer_code in ('vg96e2tc', 'dp41etyr', 'z950cse4', 'fysepc10');

-- `6qxsk9kq` e `nz3ob9r2`: SÓ `papel` (renovação, não entrada — pedido
-- explícito do orquestrador de NÃO tocar `entrada_do_programa` nestes dois;
-- são programas/ciclos diferentes, efeito de reclassificar seria outro e não
-- foi medido). categoria continua 'sinal', intocada.
update public.hm_product_catalog
   set papel = coalesce(papel, 'renovacao')
 where offer_code in ('6qxsk9kq', 'nz3ob9r2');

do $$
declare
  v_qm  record;
  v_saldos int;
  v_renov  int;
begin
  select product_id, produto_checkout, papel, entrada_do_programa
    into v_qm from public.hm_product_catalog where offer_code = 'qm4lu7py';
  if v_qm.product_id is distinct from '3094405' or v_qm.produto_checkout is distinct from 'P84471811S'
     or v_qm.papel is distinct from 'entrada' or v_qm.entrada_do_programa is distinct from true then
    raise exception '0255b: qm4lu7py não ficou como esperado (product_id=%, produto_checkout=%, papel=%, entrada_do_programa=%).',
      v_qm.product_id, v_qm.produto_checkout, v_qm.papel, v_qm.entrada_do_programa;
  end if;

  select count(*) into v_saldos from public.hm_product_catalog
   where offer_code in ('vg96e2tc', 'dp41etyr', 'z950cse4', 'fysepc10')
     and product_id = '3094405' and produto_checkout = 'P84471811S' and papel = 'saldo';
  if v_saldos <> 4 then
    raise exception '0255b: esperava 4 saldos AURUM com product_id/produto_checkout/papel preenchidos e achei %.', v_saldos;
  end if;

  select count(*) into v_renov from public.hm_product_catalog
   where offer_code in ('6qxsk9kq', 'nz3ob9r2') and papel = 'renovacao';
  raise notice '0255b: qm4lu7py OK. 4 saldos AURUM OK. % de 2 renovações marcadas com papel=renovacao (categoria e entrada_do_programa intocadas nestas duas).',
    v_renov;
end $$;

-- Contagem de 6qxsk9kq/nz3ob9r2 (pedida no plano original): medida pelo
-- orquestrador nesta rodada — 6qxsk9kq = 5 compras/5 pessoas/R$12.484,97
-- (23/06-12/08, só APPROVED); nz3ob9r2 = 11 compras/11 pessoas/R$22.000,02
-- (18/04-17/06, APPROVED+COMPLETE). Sem REFUNDED/PROTESTED/CHARGEBACK na
-- lista de status de nenhum dos dois — não precisam do mesmo tratamento de
-- estorno que o qm4lu7py, e continuam fora de `entrada_do_programa` por
-- decisão de escopo (são outro ciclo/programa), não por medo de estorno.

-- Volta:
--   -- 1) reverter o patch da view (padrão simétrico ao PATCH 1 acima):
--   do $$
--   declare
--     v_def text; v_qtd int;
--     v_padrao text := '\(si\.comprador_id IS NOT NULL AND es\.comprador_id IS NULL\)\s+AS pagou_entrada_do_programa';
--     v_novo   text := '(si.comprador_id IS NOT NULL) AS pagou_entrada_do_programa';
--   begin
--     select pg_get_viewdef('cs.vw_hm_carteira'::regclass, true) into v_def;
--     select count(*) into v_qtd from regexp_matches(v_def, v_padrao);
--     if v_qtd <> 1 then raise exception '0255b volta: padrao nao achado, % ocorrencias.', v_qtd; end if;
--     execute 'create or replace view cs.vw_hm_carteira as ' || regexp_replace(v_def, v_padrao, v_novo);
--   end $$;
--   -- 2) reverter a régua e a vitrine:
--   update public.hm_product_catalog set entrada_do_programa = false where offer_code = 'qm4lu7py';
--   update public.hm_product_catalog set product_id = null, produto_checkout = null, papel = null
--     where offer_code in ('qm4lu7py','vg96e2tc','dp41etyr','z950cse4','fysepc10');
--   update public.hm_product_catalog set papel = null where offer_code in ('6qxsk9kq','nz3ob9r2');
--   (reversão completa; nenhum outro objeto criado nesta migration)
