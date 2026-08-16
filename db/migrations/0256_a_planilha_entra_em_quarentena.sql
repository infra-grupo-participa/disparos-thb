-- 0256_a_planilha_entra_em_quarentena.sql
-- A planilha do Marcio ("Links necessários.xlsx", exportada em UTF-8 para
-- ofertas-planilha.csv) entra no banco — mas em QUARENTENA, nunca direto no
-- catálogo (`public.hm_product_catalog`).
--
-- ---------------------------------------------------------------------------
-- POR QUE QUARENTENA E NÃO CATÁLOGO DIRETO
--
-- A planilha NÃO é só um catálogo. Lida linha a linha (linha 3 do CSV):
-- Produto="Holding Masters", Nome="Renata Farias Bassi;renatafbassi@gmail.com",
-- Explicação="Reclamação quanto aos juros", "Nome da oferta na
-- Hotmart"="REALIZAR CANCELAMENTO. Aluna informou que...", SEM código, SEM
-- link. Escrever isso direto em `hm_product_catalog` corromperia a tabela que
-- decide o que 242 pessoas devem. Por isso: staging append-only primeiro,
-- promoção controlada depois (0257), tela de conferência em cima (B6/F6,
-- {base}/ofertas) — nada entra no catálogo sem humano confirmando.
--
-- ---------------------------------------------------------------------------
-- APPEND-ONLY, E POR QUÊ NÃO EXISTE COLUNA "RESOLVIDO"
--
-- Lição da 0177 (achado do pentester): a 0001 dá `alter default privileges`
-- a `disparos_app` em TODA tabela nova do schema `cs` — sem `revoke update,
-- delete` a prova é reescrevível e não prova nada. Aqui vai além: NENHUMA
-- coluna de "resolvido" foi criada de propósito. Marcar resolvido exigiria
-- UPDATE, que o revoke abaixo proíbe. Resolução é LINHA NOVA — um lote de
-- reimportação com o dado corrigido, ou uma edição manual direto no catálogo
-- (0257 registra `origem_ref` apontando para o `id` da linha de staging que
-- originou a promoção).
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION SEMEIA: A PLANILHA DE 16/08, UMA VEZ
--
-- 65 linhas de dado (66 linhas abaixo do cabeçalho, 1 separador "LINKS A
-- GERAR" descartado — mesma contagem do analista de dados). `linha_num` é a
-- linha do CSV original, para dar para conferir contra a planilha a qualquer
-- momento. `valor_txt` guarda o texto CRU (auditoria); `valor_num_planilha`
-- é o parse (mesma regra de `parse_valor` usada para medir em produção —
-- resolve os 7 formatos observados, entre eles o clássico "R$ 14.700" que um
-- parse ingênuo leria como 14,70).
--
-- 8 linhas nascem com `motivo_quarentena` preenchido — não promovem sozinhas:
--   · 2 sem código e sem link (pedido de cancelamento de pessoa física;
--     "Aurum Jusy 57.700" sem oferta gerada) — medidas pelo orquestrador,
--     16/08;
--   · n84xawd3 — rótulo diz Aurum/ETHB, link aponta para produto do HM;
--   · 8vil8s4u — valor não casa com nenhum saldo medido do AURUM;
--   · 6xys4ypa, t8yzswu6 — sem link na planilha, mas com R$72.999,09
--     aprovados no banco: a planilha está atrasada da realidade, não só no
--     s8i8edv7 (0188) — em todo o ETHB Lote 2;
--   · bgu5i1zd, t4pje4k3 — achado ADICIONAL deste backend (16/08): `valor_txt`
--     é texto livre com valor DIVIDIDO entre múltiplos links ("R$ 13.000
--     dividido em dois links... R$ 6.500"). Um parser automático pega o
--     PRIMEIRO número (13.000) e promoveria `valor_tabela` errado — a regra
--     do Marcio é literal ("não pode ter nenhum dado errado, um real que
--     seja errado"), então estas duas ficam de fora até humano decidir.
--
-- Idempotente: reaplicar a migration criaria um LOTE novo (comportamento
-- correto de append-only) — por isso a semeadura roda dentro de um guard que
-- só insere se este lote específico (constante, ver `v_arquivo`) ainda não
-- foi importado.

-- ---------------------------------------------------------------------------
-- CONTAR ANTES (rodar e colar a saída ANTES de aplicar):
--   select to_regclass('cs.oferta_planilha_staging');   -- esperado: NULL (tabela não existe)
-- ---------------------------------------------------------------------------

create table if not exists cs.oferta_planilha_staging (
  id                  bigserial primary key,
  lote                uuid not null,
  arquivo             text not null,
  linha_num           int  not null,
  produto_txt         text,
  nome_txt            text,
  valor_txt           text,
  valor_num_planilha  numeric(14,2),
  explicacao_txt      text,
  nome_hotmart_txt    text,
  offer_code          text,
  link                text,
  produto_checkout    text,
  motivo_quarentena   text,
  importado_em        timestamptz not null default now(),
  importado_por       text not null
);

comment on table cs.oferta_planilha_staging is
  '0256: a planilha de ofertas do Marcio, crua, append-only. motivo_quarentena
   NÃO NULO = precisa de revisão humana antes de promover (0257). NÃO existe
   coluna de "resolvido" — resolução é LOTE NOVO, nunca UPDATE (lição 0177).
   Import nunca escreve direto em public.hm_product_catalog.';

create index if not exists ix_oferta_planilha_staging_lote
  on cs.oferta_planilha_staging (lote);
create index if not exists ix_oferta_planilha_staging_offer_code
  on cs.oferta_planilha_staging (offer_code);

-- APPEND-ONLY (lição da 0177, achado do pentester).
revoke update, delete on cs.oferta_planilha_staging from disparos_app;
grant  select, insert on cs.oferta_planilha_staging to disparos_app;

-- ---------------------------------------------------------------------------
-- SEMEADURA: a planilha "Links necessários.xlsx" de 16/08/2026, uma vez.
-- ---------------------------------------------------------------------------
do $$
declare
  v_lote    uuid := gen_random_uuid();
  v_arquivo constant text := 'Links necessarios.xlsx (16/08/2026)';
  v_ja_importado int;
begin
  select count(*) into v_ja_importado
    from cs.oferta_planilha_staging
   where arquivo = v_arquivo;

  if v_ja_importado > 0 then
    raise notice '0256: % já importado (% linhas) — migration idempotente, não reimporta.',
      v_arquivo, v_ja_importado;
    return;
  end if;

  insert into cs.oferta_planilha_staging
    (lote, arquivo, linha_num, produto_txt, nome_txt, valor_txt, valor_num_planilha,
     explicacao_txt, nome_hotmart_txt, offer_code, link, produto_checkout,
     motivo_quarentena, importado_por)
  select v_lote, v_arquivo, linha_num, produto_txt, nome_txt, valor_txt,
         valor_num_planilha, explicacao_txt, nome_hotmart_txt, offer_code, link,
         produto_checkout, motivo_quarentena, 'migration:0256'
    from (values
    (2, 'Renovação Holding Masters - acesso dez/26 + ingresso plateia ETHB', '5 alunos', 'R$ 2.497,00', 2497.0, 'Renovação ex alunos. Ingresso Plateia', null, '6qxsk9kq', 'https://pay.hotmart.com/L97981750T?off=6qxsk9kq', 'L97981750T', null),
    (3, 'Holding Masters', 'Renata Farias Bassi;renatafbassi@gmail.com', 'R$ 13.000', 13000.0, 'Reclamação quanto aos juros', 'REALIZAR CANCELAMENTO.
Aluna informou que em momento algum foi informado durante o evento que o parcelamento do saldo teria juros. So consegue pagar mil reais por mês, sem juros.', null, null, null, 'Sem codigo e sem link -- nao e oferta, e pedido de cancelamento de pessoa fisica. Revisao humana; nao promover para o catalogo.'),
    (4, 'Holding Masters', 'Melina Wilasco', 'R$ 13.000 dividido em dois links diferentes no boleto (R$ 6.500)', 13000.0, 'Um link de 6.500, no boleto (10x). Cada sócia pagará esse valor', null, 'bgu5i1zd', 'https://pay.hotmart.com/L97981750T?off=bgu5i1zd', 'L97981750T', 'valor_txt e texto livre com valor dividido entre multiplos links (''R$ 13.000 dividido em dois links diferentes no boleto (R$ 6.500)'') -- parse automatico pega o PRIMEIRO numero e pode nao ser o valor real da oferta (achado adicional do backend, 16/08, alem da lista do orquestrador). Revisao humana antes de promover valor_tabela.'),
    (5, 'Aurum', '-', 'R$ 43.000', 43000.0, 'Saldo Aurum POA (cartão)', null, 'vg96e2tc', 'https://pay.hotmart.com/P84471811S?off=vg96e2tc', 'P84471811S', null),
    (6, 'ETHB 2026', null, 'R$ 500', 500.0, 'Plateia para VIP - Lote 1', null, '7ekxtlls', 'https://pay.hotmart.com/R101026783U?off=7ekxtlls', 'R101026783U', null),
    (7, 'ETHB 2026', null, 'R$ 1000', 1000.0, 'Vip para Diamond - Lote 1', null, 'j3jmszma', 'https://pay.hotmart.com/R101026783U?off=j3jmszma', 'R101026783U', null),
    (8, 'ETHB 2026', null, 'R$ 1.500', 1500.0, 'Plateia para Diamond - Lote 1', 'Encontro do Time Holding Brasil/2026 SP - Migração PLATEIA para DIAMOND - LOTE1', '2euebtzg', 'https://pay.hotmart.com/R101026783U?off=2euebtzg', 'R101026783U', null),
    (9, 'ETHB 2026', null, null, null, 'Acesso Plateia - LOTE 2', null, '6xys4ypa', null, null, 'Sem link na planilha, mas com compras aprovadas no banco (R$ 31.083,05, 39 compras) -- planilha esta atrasada da realidade. Revisao humana: gerar link novo ou confirmar oferta.'),
    (10, 'ETHB 2026', null, null, null, 'Acesso VIP - LOTE 2', null, 't8yzswu6', null, null, 'Sem link na planilha, mas com compras aprovadas no banco (R$ 41.916,04, 28 compras) -- planilha esta atrasada da realidade. Revisao humana: gerar link novo ou confirmar oferta.'),
    (11, 'Aurum', null, 'R$ 45.000', 45000.0, 'Parte 2 Aurum - 90.000', 'Saldo Aurum pelo resultado - R$ 45.000', 'dp41etyr', 'https://pay.hotmart.com/P84471811S?off=dp41etyr', 'P84471811S', null),
    (12, 'Holding Masters - Sinal R$ 300 de R$ 15.000', null, 'R$ 300', 300.0, 'Sinal live 25/06 para ex HT - venda do novo HM', 'Holding Masters - Sinal R$ 300 de R$ 15.000', 'z391kxd9', 'https://pay.hotmart.com/L97981750T?off=z391kxd9', 'L97981750T', null),
    (13, 'Holding Masters - Saldol R$ 12.700 de R$ 15.000', null, 'R$ 14.700', 14700.0, 'Saldo live 25/06 para ex HT - venda do novo HM', 'Holding Masters - Saldo 14.700 de R$ 15.000 - acesso por 1 ano', '2vibw97m', 'https://pay.hotmart.com/L97981750T?off=2vibw97m', 'L97981750T', null),
    (14, 'Aurum', 'Cícero', 'R$ 21.500', 21500.0, 'Saldo Aurum - POA. O aluno pagará 21.500 nesse mês e os outros 21.500 no próximo mes', 'Saldo Aurum (1de2 R$ 21.500 de R$ 43.000)', 'z950cse4', 'https://pay.hotmart.com/P84471811S?off=z950cse4', 'P84471811S', null),
    (15, 'Aurum', '-', 'R$ 43.000', 43000.0, 'Saldo Aurum POA - boleto parcelado', 'Saldo Aurum POA - boleto parcelado (R$ 43.000)', 'fysepc10', 'https://pay.hotmart.com/P84471811S?off=fysepc10', 'P84471811S', null),
    (16, 'Holding Masters - Saldol R$ 12.700 de R$ 15.000 (recorrente)', null, 'R$ 14.700', 14700.0, 'Saldo live 25/06 para ex HT - venda do novo HM (recorrente)', 'Holding Masters - Saldo 14.700 de R$ 15.000 - acesso por 1 ano (Recorrência)', '2mxcjw8t', 'https://pay.hotmart.com/L97981750T?off=2mxcjw8t', 'L97981750T', null),
    (17, 'Holding Masters - Saldo 6.500', 'Hudson Castro', 'R$ 13.000 dividido em 2x no pix (R$ 6.500)', 13000.0, null, 'Holding Masters - saldo Hudson Castr (R$ 6.500 de R$ 13.000)', 't4pje4k3', 'https://pay.hotmart.com/L97981750T?off=t4pje4k3', 'L97981750T', 'valor_txt e texto livre com valor dividido entre multiplos links (''R$ 13.000 dividido em 2x no pix (R$ 6.500)'') -- parse automatico pega o PRIMEIRO numero e pode nao ser o valor real da oferta (achado adicional do backend, 16/08, alem da lista do orquestrador). Revisao humana antes de promover valor_tabela.'),
    (18, 'Catena no Fire', null, '32823.01', 32823.01, null, null, 'frw73xd5', 'https://pay.hotmart.com/G106745288D?off=frw73xd5', 'G106745288D', null),
    (19, 'Wiliam Loro no Fire', null, '32823.01', 32823.01, null, null, 'b6feodjs', 'https://pay.hotmart.com/G106745288D?off=b6feodjs', 'G106745288D', null),
    (20, 'Saldo HM Programa de Implementação', null, '13960.27', 13960.27, null, null, '1ayp826g', 'https://pay.hotmart.com/L97981750T?off=1ayp826g', 'L97981750T', null),
    (21, 'Saldo HM Programa de Implementação', null, '12,772.68', 12772.68, null, null, 'ikgazdy8', 'https://pay.hotmart.com/L97981750T?off=ikgazdy8', 'L97981750T', null),
    (22, 'Saldo ATM Programa de Implementação', null, '4900.0', 4900.0, null, null, 'wkd93am7', 'https://pay.hotmart.com/L97981750T?off=wkd93am7', 'L97981750T', null),
    (23, 'Saldo HM Programa de Implementação', null, '13254.87', 13254.87, null, null, '2jaj1deq', 'https://pay.hotmart.com/L97981750T?off=2jaj1deq', 'L97981750T', null),
    (24, 'Saldo HM Programa de Implementação', null, '11675.34', 11675.34, null, null, 'cx3rwir9', 'https://pay.hotmart.com/L97981750T?off=cx3rwir9', 'L97981750T', null),
    (25, 'Saldo HM Programa de Implementação', null, '11084.28', 11084.28, null, null, 'ntebmlv0', 'https://pay.hotmart.com/L97981750T?off=ntebmlv0', 'L97981750T', null),
    (26, 'Saldo HM Programa de Implementação', null, '11042.47', 11042.47, null, null, '5uqyub1h', 'https://pay.hotmart.com/L97981750T?off=5uqyub1h', 'L97981750T', null),
    (27, 'Saldo HM Programa de Implementação', null, '6891.78', 6891.78, null, null, 'cck38o0v', 'https://pay.hotmart.com/L97981750T?off=cck38o0v', 'L97981750T', null),
    (28, 'Saldo HM Programa de Implementação', null, '645.21', 645.21, null, null, 'yuzm73ri', 'https://pay.hotmart.com/L97981750T?off=yuzm73ri', 'L97981750T', null),
    (29, 'Saldo HM Programa de Implementação', null, '4968.49', 4968.49, null, null, 'ym44m2ea', 'https://pay.hotmart.com/L97981750T?off=ym44m2ea', 'L97981750T', null),
    (30, 'Saldo HM Programa de Implementação', null, '6932.88', 6932.88, null, null, 'yqipi87j', 'https://pay.hotmart.com/L97981750T?off=yqipi87j', 'L97981750T', null),
    (31, 'Saldo HM Programa de Implementação', null, '7235.26', 7235.26, null, null, 'izxq8lmo', 'https://pay.hotmart.com/L97981750T?off=izxq8lmo', 'L97981750T', null),
    (32, 'Saldo HM Programa de Implementação', null, '8782.19', 8782.19, null, null, 'm0qvagzx', 'https://pay.hotmart.com/L97981750T?off=m0qvagzx', 'L97981750T', null),
    (33, 'Saldo HM Programa de Implementação', null, '8823.29', 8823.29, null, null, 'tomp81oq', 'https://pay.hotmart.com/L97981750T?off=tomp81oq', 'L97981750T', null),
    (34, 'Saldo HM Programa de Implementação', null, '9440.78', 9440.78, null, null, 'sxjnedi5', 'https://pay.hotmart.com/L97981750T?off=sxjnedi5', 'L97981750T', null),
    (35, 'Saldo HM Programa de Implementação', null, '11806.85', 11806.85, null, null, '9rf41pie', 'https://pay.hotmart.com/L97981750T?off=9rf41pie', 'L97981750T', null),
    (36, 'Saldo HM Programa de Implementação', null, '11964.38', 11964.38, null, null, 'j7lx2qdp', 'https://pay.hotmart.com/L97981750T?off=j7lx2qdp', 'L97981750T', null),
    (37, 'Saldo HM Programa de Implementação', null, '12501.93', 12501.93, null, null, 'z244ubp2', 'https://pay.hotmart.com/L97981750T?off=z244ubp2', 'L97981750T', null),
    (38, 'Saldo HM Programa de Implementação', null, '12802.58', 12802.58, null, null, 'bgr5c91b', 'https://pay.hotmart.com/L97981750T?off=bgr5c91b', 'L97981750T', null),
    (39, 'Saldo HM Programa de Implementação', null, '12990.41', 12990.41, null, null, 'du5wsb5t', 'https://pay.hotmart.com/L97981750T?off=du5wsb5t', 'L97981750T', null),
    (40, 'Saldo HM Programa de Implementação', null, '9,358.60', 9358.6, null, null, '7sjhxiz8', 'https://pay.hotmart.com/L97981750T?off=7sjhxiz8', 'L97981750T', null),
    (41, 'Saldo HM Programa de Implementação', null, '12512.02', 12512.02, null, null, '8a7xapie', 'https://pay.hotmart.com/L97981750T?off=8a7xapie', 'L97981750T', null),
    (42, 'Saldo HM Programa de Implementação', null, '10765.0', 10765.0, null, null, 'dl54fceb', 'https://pay.hotmart.com/L97981750T?off=dl54fceb', 'L97981750T', null),
    (43, 'Saldo HM Programa de Implementação', null, '4,212.33', 4212.33, null, null, 't8t12rup', 'https://pay.hotmart.com/L97981750T?off=t8t12rup', 'L97981750T', null),
    (44, 'Saldo HM Programa de Implementação', 'Jusy', '13.402,67', 13402.67, null, null, '7nzol8wb', 'https://pay.hotmart.com/L97981750T?off=7nzol8wb', 'L97981750T', null),
    (45, 'Saldo HM Programa de Implementação', 'Kelly', '12.969,79', 12969.79, null, null, 'r9wdsusx', 'https://pay.hotmart.com/L97981750T?off=r9wdsusx', 'L97981750T', null),
    (46, 'Saldo HM Programa de Implementação', 'Kelly', '7.072,60', 7072.6, null, null, '8dgokcy4', 'https://pay.hotmart.com/L97981750T?off=8dgokcy4', 'L97981750T', null),
    (47, 'Saldo HM Programa de Implementação', 'Jusy', '10330.38', 10330.38, null, null, '32e1n186', 'https://pay.hotmart.com/L97981750T?off=32e1n186', 'L97981750T', null),
    (48, 'Tranmissão Online THB SP 2026', null, '197.0', 197.0, null, null, 'ljiov5j3', 'https://pay.hotmart.com/F84471622V?off=ljiov5j3', 'F84471622V', null),
    (49, 'Sinal Aurum ETHB/SP R$ 1.000 de R$ 60.000', null, '1000.0', 1000.0, null, null, 'qm4lu7py', 'https://pay.hotmart.com/P84471811S?off=qm4lu7py', 'P84471811S', null),
    (50, 'Encontro do Time Holding Brasil/2027', null, '497.0', 497.0, null, null, 'j0gsd19c', 'https://pay.hotmart.com/R101026783U?off=j0gsd19c', 'R101026783U', null),
    (52, 'Saldo HM Programa de Implementação', null, '14303.0', 14303.0, null, null, 's8i8edv7', 'https://pay.hotmart.com/L97981750T?off=s8i8edv7', 'L97981750T', null),
    (53, 'Saldo HM Programa de Implementação', null, '13041.35', 13041.35, null, null, 'c26ip733', 'https://pay.hotmart.com/L97981750T?off=c26ip733', 'L97981750T', null),
    (54, 'Saldo HM Programa de Implementação', null, '9701.18', 9701.18, null, null, '1wvjy28l', 'https://pay.hotmart.com/L97981750T?off=1wvjy28l', 'L97981750T', null),
    (55, 'Saldo HM Programa de Implementação', null, '12715.150684931506', 12715.15, null, null, 'art7p6yd', 'https://pay.hotmart.com/L97981750T?off=art7p6yd', 'L97981750T', null),
    (56, 'Saldo HM Programa de Implementação', null, '9.742,27', 9742.27, null, null, 'u1nhykj5', 'https://pay.hotmart.com/L97981750T?off=u1nhykj5', 'L97981750T', null),
    (57, 'Saldo HM Programa de Implementação', null, '13.218,88', 13218.88, null, null, 'pmak6v9u', 'https://pay.hotmart.com/L97981750T?off=pmak6v9u', 'L97981750T', null),
    (58, 'Saldo HM Programa de Implementação', null, '12.726,10', 12726.1, null, null, 'd8bf90k9', 'https://pay.hotmart.com/L97981750T?off=d8bf90k9', 'L97981750T', null),
    (59, 'Saldo HM Programa de Implementação', null, '13.120,62', 13120.62, null, null, '2g38mv98', 'https://pay.hotmart.com/L97981750T?off=2g38mv98', 'L97981750T', null),
    (60, 'Saldo Aurum - ETHB', null, '45927.32', 45927.32, null, null, 'vzehb16i', 'https://pay.hotmart.com/P84471811S?off=vzehb16i', 'P84471811S', null),
    (61, 'Saldo Aurum - ETHB', null, '52876.71', 52876.71, null, null, '8vil8s4u', 'https://pay.hotmart.com/P84471811S?off=8vil8s4u', 'P84471811S', 'Valor (R$ 52.876,71) nao casa com nenhum dos 35 saldos medidos do AURUM em producao (14/08). Revisao humana antes de promover.'),
    (62, 'Saldo Aurum - ETHB', null, '49917.81', 49917.81, null, null, '4y1ggvj9', 'https://pay.hotmart.com/P84471811S?off=4y1ggvj9', 'P84471811S', null),
    (63, 'Saldo Aurum - ETHB', null, '59000.0', 59000.0, null, null, 'e288p4zk', 'https://pay.hotmart.com/P84471811S?off=e288p4zk', 'P84471811S', null),
    (64, 'Saldo Aurum - ETHB', null, '58700.0', 58700.0, null, null, '5jhjnhe8', 'https://pay.hotmart.com/P84471811S?off=5jhjnhe8', 'P84471811S', null),
    (65, 'Saldo Aurum - ETHB', null, '51808.22', 51808.22, null, null, 'f8akw09u', 'https://pay.hotmart.com/P84471811S?off=f8akw09u', 'P84471811S', null),
    (66, 'Saldo Aurum - ETHB - R$ 13.800,00 ou em 12 x de R$ 1.461,05 * no cartão', null, null, null, null, null, 'n84xawd3', 'https://pay.hotmart.com/L97981750T?off=n84xawd3', 'L97981750T', 'Rotulo diz "Saldo Aurum - ETHB" mas o link aponta para produto do HM (L97981750T) -- contradicao entre rotulo e link. Revisao humana antes de promover.'),
    (67, 'Saldo Aurum - ETHB', 'Jusy', '57700.0', 57700.0, null, null, null, null, null, 'Sem codigo e sem link na planilha -- saldo aparentemente legitimo mas sem oferta gerada na Hotmart. Revisao humana: gerar link ou confirmar antes de promover.')
    ) as t(linha_num, produto_txt, nome_txt, valor_txt, valor_num_planilha,
           explicacao_txt, nome_hotmart_txt, offer_code, link, produto_checkout,
           motivo_quarentena);

  raise notice '0256: % linhas importadas da planilha no lote % (% em quarentena).',
    (select count(*) from cs.oferta_planilha_staging where lote = v_lote),
    v_lote,
    (select count(*) from cs.oferta_planilha_staging where lote = v_lote and motivo_quarentena is not null);
end $$;

-- CONTAR DEPOIS (esperado: 65 linhas no lote novo, 8 com motivo_quarentena):
--   select count(*), count(*) filter (where motivo_quarentena is not null)
--     from cs.oferta_planilha_staging
--    where arquivo = 'Links necessarios.xlsx (16/08/2026)';

-- Volta:
--   drop table if exists cs.oferta_planilha_staging;
-- Nada fora deste schema lê esta tabela ainda (0257 é quem lê, na mesma leva).
